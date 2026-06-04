import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import Anthropic from '@anthropic-ai/sdk';
import { initializeDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

export interface WeeklyReport {
  week_start: string;
  headline: string;
  volume_summary: string;
  key_insight: string;
  recommendation: string;
  recovery_status: 'good' | 'moderate' | 'poor';
  generated_at: string;
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** Returns the most recent Monday as yyyy-MM-dd */
function lastMonday(): string {
  const d = new Date();
  const day = d.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().split('T')[0];
}

async function generateReport(weekStart: string): Promise<WeeklyReport> {
  const cutoff14 = new Date(Date.now() - 14 * 86400000).toISOString();
  const cutoff7  = new Date(Date.now() - 7  * 86400000).toISOString();

  const [acts14, well14] = await Promise.all([
    sql`SELECT activity_type, date, distance_km, duration_seconds, avg_hr, tss, title
        FROM activities WHERE date >= ${cutoff14} ORDER BY date`,
    sql`SELECT date, sleep_hours, stress_score, body_battery, resting_hr, vo2max
        FROM wellness WHERE date >= ${cutoff14} ORDER BY date`,
  ]);

  // Split into this week vs last week
  const thisWeekActs = acts14.rows.filter(r => new Date(r.date) >= new Date(cutoff7));
  const lastWeekActs = acts14.rows.filter(r => new Date(r.date) < new Date(cutoff7));
  const thisWeekWell = well14.rows.filter(r => new Date(r.date) >= new Date(cutoff7));
  const lastWeekWell = well14.rows.filter(r => new Date(r.date) < new Date(cutoff7));

  const avgOf = (rows: Record<string, unknown>[], key: string) => {
    const vals = rows.map(r => Number(r[key])).filter(v => !isNaN(v) && v > 0);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const sumOf = (rows: Record<string, unknown>[], key: string) =>
    rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);

  const stats = {
    this_week: {
      activity_count: thisWeekActs.length,
      total_km: Math.round(sumOf(thisWeekActs, 'distance_km') * 10) / 10,
      total_tss: Math.round(sumOf(thisWeekActs, 'tss')),
      by_type: {
        running: thisWeekActs.filter(a => a.activity_type === 'running').length,
        cycling: thisWeekActs.filter(a => a.activity_type === 'cycling').length,
        walking: thisWeekActs.filter(a => a.activity_type === 'walking').length,
      },
      running_km: Math.round(sumOf(thisWeekActs.filter(a => a.activity_type === 'running'), 'distance_km') * 10) / 10,
      cycling_km: Math.round(sumOf(thisWeekActs.filter(a => a.activity_type === 'cycling'), 'distance_km') * 10) / 10,
      avg_sleep: avgOf(thisWeekWell, 'sleep_hours')?.toFixed(1) ?? null,
      avg_hr: Math.round(avgOf(thisWeekActs, 'avg_hr') ?? 0) || null,
      avg_body_battery: Math.round(avgOf(thisWeekWell, 'body_battery') ?? 0) || null,
      avg_stress: Math.round(avgOf(thisWeekWell, 'stress_score') ?? 0) || null,
    },
    last_week: {
      activity_count: lastWeekActs.length,
      total_km: Math.round(sumOf(lastWeekActs, 'distance_km') * 10) / 10,
      total_tss: Math.round(sumOf(lastWeekActs, 'tss')),
      avg_sleep: avgOf(lastWeekWell, 'sleep_hours')?.toFixed(1) ?? null,
      avg_body_battery: Math.round(avgOf(lastWeekWell, 'body_battery') ?? 0) || null,
    },
  };

  const prompt = `You are a concise personal fitness coach. Analyse this week vs last week and return a JSON object.

Data:
${JSON.stringify(stats, null, 2)}

Return ONLY valid JSON (no markdown) matching this exact shape:
{
  "headline": "one punchy sentence (max 12 words) about this week",
  "volume_summary": "e.g. '3 runs (28 km), 2 rides (—)' — use em dash for zero distance sports",
  "key_insight": "the single most interesting observation from the data (1–2 sentences, cite numbers)",
  "recommendation": "one concrete action for next week (1 sentence)",
  "recovery_status": "good" | "moderate" | "poor"
}

recovery_status logic: good = sleep ≥7h AND body_battery ≥50 AND stress <50; poor = sleep <6h OR body_battery <30 OR stress ≥70; else moderate.`;

  const resp = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = resp.content[0].type === 'text' ? resp.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let parsed: Partial<WeeklyReport> = {};
  try { parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}; } catch { /* fall through */ }

  // Build a fallback volume summary if Claude omitted it
  const runCount  = stats.this_week.by_type.running;
  const rideCount = stats.this_week.by_type.cycling;
  const walkCount = stats.this_week.by_type.walking;
  const fallbackVolume = [
    runCount  ? `${runCount} run${runCount !== 1 ? 's' : ''} (${stats.this_week.running_km} km)` : null,
    rideCount ? `${rideCount} ride${rideCount !== 1 ? 's' : ''} (${stats.this_week.cycling_km} km)` : null,
    walkCount ? `${walkCount} walk${walkCount !== 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(', ') || 'No activities this week';

  return {
    week_start: weekStart,
    headline: parsed.headline ?? 'Week in review',
    volume_summary: parsed.volume_summary ?? fallbackVolume,
    key_insight: parsed.key_insight ?? 'Keep training consistently.',
    recommendation: parsed.recommendation ?? 'Maintain your current routine.',
    recovery_status: parsed.recovery_status ?? 'moderate',
    generated_at: new Date().toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    await initializeDatabase();
    const force = req.nextUrl.searchParams.get('force') === '1';
    const weekStart = lastMonday();

    if (!force) {
      const cached = await sql`
        SELECT report_json, generated_at FROM weekly_report
        WHERE week_start = ${weekStart}
          AND generated_at > NOW() - INTERVAL '7 days'
        ORDER BY generated_at DESC LIMIT 1
      `;
      if (cached.rows.length > 0) {
        const report = JSON.parse(cached.rows[0].report_json as string) as WeeklyReport;
        return NextResponse.json({ report, cached: true });
      }
    }

    const report = await generateReport(weekStart);

    // Save to DB (delete old entry for this week first, then insert fresh)
    await sql`DELETE FROM weekly_report WHERE week_start = ${weekStart}`;
    await sql`
      INSERT INTO weekly_report (week_start, report_json)
      VALUES (${weekStart}, ${JSON.stringify(report)})
    `;

    return NextResponse.json({ report, cached: false });
  } catch (err) {
    console.error('[weekly-report]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
