import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { streamChat } from '@/lib/ai';
import { coerceActivity, coerceWellness } from '@/lib/db';
import { ChatMessage } from '@/types';
import type { UserSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

// ── Per-second sample summarisation ─────────────────────────────────────────

interface RawSample { e: number; hr: number | null; power: number | null }

export interface ActivitySampleSummary {
  title: string;
  date: string;
  type: string;
  duration_min: number;
  sample_count: number;
  avg_hr: number | null;
  avg_power: number | null;
  normalized_power: number | null;
  intensity_factor: number | null;
  best_5min_power: number | null;
  best_20min_power: number | null;
  hr_zones_pct: { z1: number; z2: number; z3: number; z4: number; z5: number } | null;
  aerobic_decoupling_pct: number | null; // % drift in Power:HR ratio first→second half
}

function computeSampleSummary(
  samples: RawSample[],
  maxHR: number | null,
  ftp: number | null,
): Omit<ActivitySampleSummary, 'title' | 'date' | 'type' | 'duration_min'> {
  const hrVals  = samples.filter(s => s.hr   != null && s.hr!   > 0).map(s => s.hr!);
  const pwrVals = samples.filter(s => s.power != null && s.power! > 0).map(s => s.power!);

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const round = (n: number | null) => n != null ? Math.round(n) : null;

  const avgHR    = round(avg(hrVals));
  const avgPower = round(avg(pwrVals));

  // Normalized Power: 30-second rolling average (3 samples × 10 s) → ^4 → mean → ^0.25
  let np: number | null = null;
  if (pwrVals.length >= 6) {
    const W = 3; // 30 s window at 10 s resolution
    const rolling: number[] = [];
    for (let i = W - 1; i < pwrVals.length; i++) {
      let sum = 0;
      for (let j = i - W + 1; j <= i; j++) sum += pwrVals[j];
      rolling.push(sum / W);
    }
    const meanFourth = rolling.reduce((a, v) => a + Math.pow(v, 4), 0) / rolling.length;
    np = Math.round(Math.pow(meanFourth, 0.25));
  }

  const if_ = np && ftp ? Math.round((np / ftp) * 100) / 100 : null;

  // Best-effort averages via sliding window
  const bestAvg = (win: number): number | null => {
    if (pwrVals.length < win) return null;
    let best = 0;
    for (let i = 0; i <= pwrVals.length - win; i++) {
      let sum = 0;
      for (let j = i; j < i + win; j++) sum += pwrVals[j];
      if (sum > best) best = sum;
    }
    return best > 0 ? Math.round(best / win) : null;
  };

  // HR zones (% of time) — using max HR boundaries: Z1<60%, Z2 60-70%, Z3 70-80%, Z4 80-90%, Z5>90%
  let hrZones: ActivitySampleSummary['hr_zones_pct'] | null = null;
  if (hrVals.length > 0 && maxHR) {
    const z = [0, 0, 0, 0, 0];
    for (const hr of hrVals) {
      const p = hr / maxHR;
      if      (p < 0.60) z[0]++;
      else if (p < 0.70) z[1]++;
      else if (p < 0.80) z[2]++;
      else if (p < 0.90) z[3]++;
      else               z[4]++;
    }
    const t = hrVals.length;
    hrZones = {
      z1: Math.round(z[0] / t * 100),
      z2: Math.round(z[1] / t * 100),
      z3: Math.round(z[2] / t * 100),
      z4: Math.round(z[3] / t * 100),
      z5: Math.round(z[4] / t * 100),
    };
  }

  // Aerobic decoupling: % change in Power:HR ratio first-half vs second-half
  let decoupling: number | null = null;
  const minLen = Math.min(pwrVals.length, hrVals.length);
  if (minLen >= 60) {
    const half = Math.floor(minLen / 2);
    const h1Pwr = avg(pwrVals.slice(0, half))!;
    const h2Pwr = avg(pwrVals.slice(half, half * 2))!;
    const h1Hr  = avg(hrVals.slice(0, half))!;
    const h2Hr  = avg(hrVals.slice(half, half * 2))!;
    if (h1Hr > 0 && h1Pwr > 0) {
      const ratio1 = h1Pwr / h1Hr;
      const ratio2 = h2Pwr / h2Hr;
      decoupling = Math.round(((ratio1 - ratio2) / ratio1) * 1000) / 10; // 1 dp
    }
  }

  return {
    sample_count: samples.length,
    avg_hr: avgHR,
    avg_power: avgPower,
    normalized_power: np,
    intensity_factor: if_,
    best_5min_power:  bestAvg(30),  // 30 × 10 s = 5 min
    best_20min_power: bestAvg(120), // 120 × 10 s = 20 min
    hr_zones_pct: hrZones,
    aerobic_decoupling_pct: decoupling,
  };
}

async function fetchSampleSummaries(
  cutoff: string,
  maxHR: number | null,
  ftp: number | null,
): Promise<ActivitySampleSummary[]> {
  // Find the 8 most-recent activities that actually have samples
  const { rows: acts } = await sql`
    SELECT a.id, a.title, a.activity_type, a.date, a.duration_seconds
    FROM activities a
    WHERE a.date >= ${cutoff}
      AND a.activity_type IN ('cycling', 'running', 'walking')
      AND EXISTS (SELECT 1 FROM activity_samples s WHERE s.activity_id = a.id)
    ORDER BY a.date DESC
    LIMIT 8
  `;
  if (acts.length === 0) return [];

  const results = await Promise.all(
    acts.map(async (act) => {
      const { rows } = await sql`
        SELECT elapsed_seconds AS e, hr, power
        FROM activity_samples
        WHERE activity_id = ${act.id}
        ORDER BY elapsed_seconds ASC
      `;
      const summary = computeSampleSummary(
        rows.map(r => ({ e: Number(r.e), hr: r.hr != null ? Number(r.hr) : null, power: r.power != null ? Number(r.power) : null })),
        maxHR,
        ftp,
      );
      return {
        title: act.title as string,
        date: (act.date as Date).toISOString().slice(0, 10),
        type: act.activity_type as string,
        duration_min: Math.round(Number(act.duration_seconds) / 60),
        ...summary,
      };
    })
  );

  return results;
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const { messages, settings }: { messages: ChatMessage[]; settings?: UserSettings } = await request.json();

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
    }

    const cutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString();

    const [actResult, wellResult, ftpResult] = await Promise.all([
      sql`SELECT * FROM activities WHERE date >= ${cutoff} ORDER BY date`,
      sql`SELECT * FROM wellness WHERE date >= ${cutoff} ORDER BY date`,
      sql`SELECT ftp_watts FROM ftp_entries ORDER BY date DESC LIMIT 1`,
    ]);

    const activities = actResult.rows.map(coerceActivity);
    const wellness   = wellResult.rows.map(coerceWellness);
    const manualFtpWatts: number | null = ftpResult.rows[0]?.ftp_watts
      ? Number(ftpResult.rows[0].ftp_watts)
      : null;

    // Resolve FTP for IF calculations (same priority as buildFullContext)
    const ftpForCalc = manualFtpWatts ?? settings?.garminFtp ?? null;
    const maxHR = settings?.maxHR ?? null;

    const sampleSummaries = await fetchSampleSummaries(cutoff, maxHR, ftpForCalc);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamChat(
            messages as Parameters<typeof streamChat>[0],
            activities,
            wellness,
            settings,
            manualFtpWatts,
            sampleSummaries,
          )) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Stream error';
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
