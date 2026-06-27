import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';

const client = new Anthropic();

export interface OutlierProposal {
  type: 'wellness_field' | 'wellness_row' | 'activity';
  id: number;
  date: string;
  field?: string;        // for wellness_field proposals
  currentValue: number | string | null;
  reason: string;        // human-readable explanation
  severity: 'high' | 'medium' | 'low';
}

export async function POST() {
  try {
    const [wellnessResult, activitiesResult] = await Promise.all([
      sql`
        SELECT id, date::text, weight_kg, steps, resting_hr, sleep_hours,
               sleep_score, body_battery, stress_score, body_fat_pct, hrv_rmssd
        FROM wellness
        WHERE date >= NOW() - INTERVAL '180 days'
        ORDER BY date ASC
      `,
      sql`
        SELECT id, date::text, activity_type, distance_km, duration_seconds,
               avg_hr, avg_power, calories
        FROM activities
        WHERE date >= NOW() - INTERVAL '180 days'
        ORDER BY date ASC
      `,
    ]);

    const wellnessRows = wellnessResult.rows;
    const activityRows = activitiesResult.rows;

    const prompt = `You are a data quality analyst for a fitness tracking app. Analyze the following 180-day dataset and identify statistical outliers or data entry errors that the user may want to review or delete.

Focus on:
- Weight values that are implausibly high/low or spike/drop by >5kg in a single day
- Resting HR that is unusually high (>90) or low (<35) compared to the person's baseline
- Steps counts that are implausibly high (>40,000) or suspiciously round numbers that suggest data error
- Sleep hours outside 2–12h range or wildly inconsistent
- Activity distances/durations that seem wrong (e.g. 1km run in 3 hours, 500km cycling in one session)
- Any metric that is 3+ standard deviations from the person's own baseline

Return a JSON array of proposals. Each proposal must have EXACTLY these fields:
- type: "wellness_field" | "wellness_row" | "activity"
- id: (the row id number)
- date: "YYYY-MM-DD"
- field: (for wellness_field only — e.g. "weight_kg")
- currentValue: (the actual suspicious value)
- reason: (one sentence explaining why it's suspicious, include the person's baseline for context)
- severity: "high" | "medium" | "low"

Return ONLY the JSON array, no other text. Maximum 20 proposals, prioritised by severity.

Wellness records (last 180 days):
${JSON.stringify(wellnessRows, null, 2)}

Activities (last 180 days):
${JSON.stringify(activityRows, null, 2)}`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '[]';
    console.log('[outliers] stop_reason:', response.stop_reason, '| raw length:', text.length);
    console.log('[outliers] raw response:', text.slice(0, 500));

    // Strip markdown code fences if present
    const jsonStr = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    let proposals: OutlierProposal[] = [];
    try {
      proposals = JSON.parse(jsonStr);
      if (!Array.isArray(proposals)) {
        console.error('[outliers] parsed value is not an array:', typeof proposals);
        proposals = [];
      }
    } catch (parseErr) {
      console.error('[outliers] JSON parse failed:', parseErr, '| text:', jsonStr.slice(0, 200));
      proposals = [];
    }

    console.log('[outliers] returning', proposals.length, 'proposals');
    return NextResponse.json({ proposals });
  } catch (e) {
    console.error('POST /api/data/outliers:', e);
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}
