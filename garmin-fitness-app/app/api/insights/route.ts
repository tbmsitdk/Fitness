import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { sql } from '@vercel/postgres';
import Anthropic from '@anthropic-ai/sdk';

const CACHE_KEY = 'ai-insights';
const CACHE_TTL = 60 * 60 * 6; // 6 hours

export interface InsightCard {
  id: string;
  type: 'positive' | 'warning' | 'neutral' | 'milestone';
  headline: string;
  body: string;
  icon: string; // emoji
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateInsights(): Promise<InsightCard[]> {
  const cutoff14 = new Date(Date.now() - 14 * 86400000).toISOString();
  const cutoff28 = new Date(Date.now() - 28 * 86400000).toISOString();

  const [act14, act28, well14, well28] = await Promise.all([
    sql`SELECT date, activity_type, distance_km, duration_seconds, avg_hr, tss FROM activities WHERE date >= ${cutoff14} ORDER BY date`,
    sql`SELECT date, activity_type, distance_km, duration_seconds, avg_hr, tss FROM activities WHERE date >= ${cutoff28} AND date < ${cutoff14} ORDER BY date`,
    sql`SELECT date, resting_hr, hrv_rmssd, sleep_hours, sleep_score, stress_score, body_battery FROM wellness WHERE date >= ${cutoff14} ORDER BY date`,
    sql`SELECT date, resting_hr, hrv_rmssd, sleep_hours, sleep_score, stress_score, body_battery FROM wellness WHERE date >= ${cutoff28} AND date < ${cutoff14} ORDER BY date`,
  ]);

  // Compute simple deltas for anomaly detection
  const avg = (rows: {[k: string]: unknown}[], key: string) => {
    const vals = rows.map(r => Number(r[key])).filter(v => !isNaN(v) && v > 0);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const stats = {
    recent_14d: {
      activities: act14.rows.length,
      total_km: act14.rows.reduce((s, r) => s + Number(r.distance_km || 0), 0).toFixed(1),
      avg_rhr: avg(well14.rows, 'resting_hr'),
      avg_hrv: avg(well14.rows, 'hrv_rmssd'),
      avg_sleep: avg(well14.rows, 'sleep_hours'),
      avg_stress: avg(well14.rows, 'stress_score'),
      avg_battery: avg(well14.rows, 'body_battery'),
    },
    prior_14d: {
      activities: act28.rows.length,
      total_km: act28.rows.reduce((s, r) => s + Number(r.distance_km || 0), 0).toFixed(1),
      avg_rhr: avg(well28.rows, 'resting_hr'),
      avg_hrv: avg(well28.rows, 'hrv_rmssd'),
      avg_sleep: avg(well28.rows, 'sleep_hours'),
      avg_stress: avg(well28.rows, 'stress_score'),
      avg_battery: avg(well28.rows, 'body_battery'),
    },
  };

  const prompt = `You are a fitness data analyst. Analyse these training metrics and generate 3-4 concise insight cards for an athlete's dashboard.

Data (comparing last 14 days vs prior 14 days):
${JSON.stringify(stats, null, 2)}

Return ONLY a JSON array of insight objects. Each object must have:
- id: short unique string (e.g. "hrv-trend")
- type: "positive" | "warning" | "neutral" | "milestone"
- headline: max 6 words, punchy
- body: max 15 words, specific with numbers
- icon: single emoji relevant to the insight

Focus on the most notable changes. Be specific with numbers. Avoid generic advice.
Examples of good headlines: "HRV recovering nicely", "Training load spike", "Sleep debt building", "New weekly volume record"

Return only valid JSON array, no markdown.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '[]';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    return JSON.parse(jsonMatch[0]) as InsightCard[];
  } catch {
    return [];
  }
}

export async function GET(_req: NextRequest) {
  try {
    let cached: InsightCard[] | null = null;
    try { cached = await kv.get<InsightCard[]>(CACHE_KEY); } catch { /* KV not provisioned */ }
    if (cached) return NextResponse.json({ insights: cached, cached: true });

    const insights = await generateInsights();
    try { await kv.set(CACHE_KEY, insights, { ex: CACHE_TTL }); } catch { /* KV not provisioned */ }
    return NextResponse.json({ insights, cached: false });
  } catch (error) {
    console.error('Insights error:', error);
    return NextResponse.json({ insights: [], error: String(error) });
  }
}

export async function DELETE() {
  try { await kv.del(CACHE_KEY); } catch { /* KV not provisioned */ }
  return NextResponse.json({ ok: true });
}
