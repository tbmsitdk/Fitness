import Anthropic from '@anthropic-ai/sdk';
import { Activity, WellnessRecord, AISummary } from '@/types';
import { compute90DaySummary } from '@/lib/training-load';
import type { UserSettings } from '@/lib/settings';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-sonnet-4-5';

const SYSTEM_PROMPT = `You are an expert personal fitness coach and longevity advisor. You analyse real training data from Garmin devices and provide evidence-based, personalised guidance.

Your coaching philosophy draws on:
- Peter Attia's longevity framework: VO2max as the strongest predictor of all-cause mortality, Zone 2 cardio as the foundation of metabolic health, strength training for healthspan
- Exercise science: periodisation, acute:chronic workload ratio, HRV as a recovery biomarker
- Practical consistency: sustainable habits beat heroic effort

Guidelines:
- Be direct, specific, and data-driven — reference actual numbers from the data
- Flag concrete injury risks (load spikes >10%, HRV decline trends, high ATL:CTL ratio)
- Recommend Zone 2 cardio targets (can hold conversation, ~60-70% max HR)
- Highlight recovery adequacy (sleep, HRV, easy days)
- Celebrate wins and progress, not just gaps
- Keep recommendations actionable and specific to this person's sport mix
- Format responses in clear sections with markdown`;

export async function generateWeeklySummary(
  activities: Activity[],
  wellness: WellnessRecord[],
  userSettings?: Partial<UserSettings>
): Promise<AISummary> {
  const summary = compute90DaySummary(activities);

  // Recent wellness trends
  const recentWellness = wellness.slice(-14);
  const avgRHR = recentWellness.filter(w => w.resting_hr).length
    ? Math.round(recentWellness.reduce((s, w) => s + (w.resting_hr ?? 0), 0) / recentWellness.filter(w => w.resting_hr).length)
    : null;
  const avgHRV = recentWellness.filter(w => w.hrv_rmssd).length
    ? Math.round(recentWellness.reduce((s, w) => s + (w.hrv_rmssd ?? 0), 0) / recentWellness.filter(w => w.hrv_rmssd).length)
    : null;
  const avgSleep = recentWellness.filter(w => w.sleep_hours).length
    ? (recentWellness.reduce((s, w) => s + (w.sleep_hours ?? 0), 0) / recentWellness.filter(w => w.sleep_hours).length).toFixed(1)
    : null;

  // Most recent VO2 max from wellness
  const recentVo2 = [...wellness].reverse().find(w => w.vo2max != null)?.vo2max ?? null;

  const contextData = {
    user_profile: userSettings ? {
      age:           userSettings.birthYear ? new Date().getFullYear() - userSettings.birthYear : null,
      sex:           userSettings.sex,
      weight_kg:     userSettings.weightKg,
      height_cm:     userSettings.heightCm,
      max_hr:        userSettings.maxHR,
      threshold_hr:  userSettings.thresholdHR,
      steps_goal:    userSettings.dailyStepsGoal,
    } : null,
    summary_90_days: summary,
    recent_14_day_wellness: {
      avg_resting_hr: avgRHR,
      avg_hrv_rmssd: avgHRV,
      avg_sleep_hours: avgSleep,
      latest_vo2max: recentVo2,
    },
    avg_weekly_tss: summary.avg_weekly_tss,
    device_notes: 'Garmin Vivosmart 5: (1) HRV is measured internally and converted to a 0–100 Stress Score via Firstbeat Analytics — the stress_score field IS the HRV-derived metric; raw RMSSD is not exposed. (2) VO₂max estimate is supported and used by Garmin to compute Fitness Age (STAT_FITNESSAGE) — a lower fitness age vs chronological age indicates above-average cardiorespiratory fitness.',
  };

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Here is my training data for the last 90 days. Please provide a comprehensive weekly coaching summary.\n\n${JSON.stringify(contextData, null, 2)}\n\nProvide your analysis in this JSON structure:\n{\n  "summary": "2-3 paragraph narrative overview of fitness status",\n  "recommendations": ["up to 5 specific actionable recommendations"],\n  "injury_risks": ["any injury risk flags, or empty array"],\n  "longevity_insights": ["2-3 longevity-focused insights from this data"]\n}`,
          },
        ],
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || text,
        recommendations: parsed.recommendations || [],
        injury_risks: parsed.injury_risks || [],
        longevity_insights: parsed.longevity_insights || [],
        generated_at: new Date().toISOString(),
      };
    }
  } catch {
    // fall through
  }

  return {
    summary: text,
    recommendations: [],
    injury_risks: [],
    longevity_insights: [],
    generated_at: new Date().toISOString(),
  };
}

export async function* streamChat(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  activities: Activity[],
  wellness: WellnessRecord[],
  userSettings?: Partial<UserSettings>
): AsyncGenerator<string> {
  const summary = compute90DaySummary(activities);
  const recentWellness = wellness.slice(-7);
  const recentVo2 = [...wellness].reverse().find(w => w.vo2max != null)?.vo2max ?? null;

  const profileSection = userSettings ? `
## Athlete Profile
${JSON.stringify({
    age:          userSettings.birthYear ? new Date().getFullYear() - userSettings.birthYear : null,
    sex:          userSettings.sex,
    weight_kg:    userSettings.weightKg,
    max_hr:       userSettings.maxHR,
    threshold_hr: userSettings.thresholdHR,
  }, null, 2)}
` : '';

  const dataContext = `${profileSection}
## Athlete Data Context (last 90 days)
${JSON.stringify(summary, null, 2)}

## Recent wellness (last 7 days)
${JSON.stringify(recentWellness.map(w => ({
    date: w.date,
    resting_hr: w.resting_hr,
    hrv_stress: w.hrv_rmssd,
    sleep_h: w.sleep_hours,
    steps: w.steps,
    vo2max: w.vo2max,
  })), null, 2)}

## Latest VO₂ Max: ${recentVo2 ?? 'not available'}
## Device notes (Garmin Vivosmart 5):
- HRV: measured internally via Firstbeat; exposed as 0–100 Stress Score (hrv_stress field). Raw RMSSD not available.
- VO₂max: estimated via Firstbeat; Garmin derives Fitness Age from it. Lower fitness_age vs chronological age = above-average cardio fitness.
`;

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT + '\n\n' + dataContext,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      yield chunk.delta.text;
    }
  }
}
