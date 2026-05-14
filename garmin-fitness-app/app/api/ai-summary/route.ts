import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { sql } from '@vercel/postgres';
import { generateWeeklySummary } from '@/lib/ai';
import { coerceActivity, coerceWellness } from '@/lib/db';
import { AISummary } from '@/types';

const CACHE_KEY = 'ai-weekly-summary';
const CACHE_TTL = 60 * 60 * 24; // 24 hours

export async function GET() {
  try {
    // Try KV cache first
    let cached: AISummary | null = null;
    try {
      cached = await kv.get<AISummary>(CACHE_KEY);
    } catch {
      // KV not provisioned — skip cache
    }

    if (cached) {
      return NextResponse.json({ ...cached, cached: true });
    }

    const cutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString();

    const [actResult, wellResult] = await Promise.all([
      sql`SELECT * FROM activities WHERE date >= ${cutoff} ORDER BY date`,
      sql`SELECT * FROM wellness WHERE date >= ${cutoff} ORDER BY date`,
    ]);

    const activities = actResult.rows.map(coerceActivity);
    const wellness = wellResult.rows.map(coerceWellness);

    if (activities.length === 0) {
      return NextResponse.json(
        { error: 'No activity data found. Please upload your Garmin export first.' },
        { status: 404 }
      );
    }

    const summary = await generateWeeklySummary(activities, wellness);

    try {
      await kv.set(CACHE_KEY, summary, { ex: CACHE_TTL });
    } catch {
      // KV not provisioned — skip caching
    }

    return NextResponse.json({ ...summary, cached: false });
  } catch (error) {
    console.error('AI summary error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await kv.del(CACHE_KEY);
  } catch {
    // KV not provisioned
  }
  return NextResponse.json({ ok: true });
}
