import Anthropic from '@anthropic-ai/sdk';
import { Activity, WellnessRecord, AISummary } from '@/types';
import { compute90DaySummary, computeTrainingLoad, estimateTSS } from '@/lib/training-load';
import { getAge, getThresholdHR, getMaxHR } from '@/lib/settings';
import { vo2maxRating } from '@/lib/vo2max';
import type { UserSettings } from '@/lib/settings';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Fable 5 for coaching quality. Routes that call this must set `export const
// maxDuration = 60` — large-model responses can take 30-60s on big payloads
// and the Vercel default function timeout is shorter.
const MODEL = 'claude-fable-5';

const SYSTEM_PROMPT = `You are an elite personal fitness coach and longevity advisor with expertise in exercise physiology, sports medicine, and preventive health. You analyse real training and health data from Garmin devices and provide evidence-based, highly personalised guidance.

Your coaching philosophy integrates:
- **Training science**: periodisation, acute:chronic workload ratio (ACWR), training load management, sport-specific development
- **Peter Attia's longevity framework**: VO2max as the #1 predictor of all-cause mortality, Zone 2 as the foundation of metabolic health, muscle mass preservation for healthspan
- **Recovery science**: sleep quality, HRV as a readiness biomarker, body battery as an energy management tool
- **Body composition**: fat vs muscle balance, visceral fat risks, metabolic health markers

Guidelines:
- Be direct, specific, and quantitative — always cite actual numbers from the data
- Reference specific metrics (e.g. "your TSB of -4.3 indicates...", "at 24.9% body fat you're...")
- Give both SHORT-TERM (this week) and LONG-TERM (next 4-8 weeks) recommendations
- Separate TRAINING recommendations from HEALTH recommendations — they are equally important
- Flag concrete risks: injury (ACWR >1.5, high monotony), overtraining (HRV decline + high TSS), health (sleep debt, body fat trends)
- Celebrate specific wins with numbers
- Be honest about weaknesses — a good coach tells hard truths kindly
- Format with clear markdown sections`;

interface FullContext {
  user_profile: Record<string, unknown>;
  training: Record<string, unknown>;
  body_composition: Record<string, unknown>;
  wellness: Record<string, unknown>;
  cycling_performance: Record<string, unknown>;
  recovery: Record<string, unknown>;
  longevity: Record<string, unknown>;
}

export function buildFullContext(
  activities: Activity[],
  wellness: WellnessRecord[],
  userSettings?: Partial<UserSettings>,
  manualFtpWatts?: number | null,
): FullContext {
  const sorted = [...wellness].sort((a, b) => a.date.localeCompare(b.date));
  const now = Date.now();

  const last14Well = sorted.filter(w => now - new Date(w.date).getTime() < 14 * 86400000);
  const last30Well = sorted.filter(w => now - new Date(w.date).getTime() < 30 * 86400000);
  const last7Well  = sorted.filter(w => now - new Date(w.date).getTime() < 7  * 86400000);

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const nonNull = <T>(arr: (T | null)[]): T[] => arr.filter((v): v is T => v != null);

  // Resolve threshold HR so HR-only activities (walks/runs with no power) get a
  // real TSS estimate instead of 0. Falls back to 85% of max HR when unset.
  const thresholdHR = userSettings
    ? getThresholdHR(userSettings as UserSettings)
    : 165;

  // Training load
  const tl = computeTrainingLoad(activities, thresholdHR);
  const latestTL = tl[tl.length - 1];
  const acwr = latestTL && latestTL.ctl > 0 ? latestTL.atl / latestTL.ctl : null;

  // 90-day summary
  const summary90 = compute90DaySummary(activities);

  // Weekly TSS last 4 weeks — use estimated TSS (same basis as CTL/ATL) so this
  // never reads 0 just because Garmin didn't attach a TSS to HR-only sessions.
  const weeklyTSS: number[] = [];
  for (let w = 0; w < 4; w++) {
    const start = now - (w + 1) * 7 * 86400000;
    const end   = now - w * 7 * 86400000;
    const tss = activities
      .filter(a => { const t = new Date(a.date).getTime(); return t >= start && t < end; })
      .reduce((s, a) => s + estimateTSS(a, thresholdHR), 0);
    weeklyTSS.unshift(Math.round(tss));
  }

  // Body composition
  const latestBC = [...sorted].reverse().find(w =>
    w.body_fat_pct != null || w.muscle_mass_kg != null);
  const bcTrend = (() => {
    const fat30   = last30Well.filter(w => w.body_fat_pct != null);
    const mus30   = last30Well.filter(w => w.muscle_mass_kg != null);
    const fatDelta = fat30.length >= 2
      ? Math.round((fat30.at(-1)!.body_fat_pct! - fat30[0].body_fat_pct!) * 10) / 10 : null;
    const musDelta = mus30.length >= 2
      ? Math.round((mus30.at(-1)!.muscle_mass_kg! - mus30[0].muscle_mass_kg!) * 10) / 10 : null;
    return { body_fat_30d_delta: fatDelta, muscle_mass_30d_delta: musDelta };
  })();

  // Cycling performance
  // FTP priority: 1) manual log (user-verified) 2) garminFtp from settings 3) p20 estimate
  const cyclingWithFTP = [...activities]
    .filter(a => a.activity_type === 'cycling' && a.ftp && a.ftp > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const p20BestFTP = cyclingWithFTP.length > 0
    ? Math.max(...cyclingWithFTP.map(a => a.ftp as number))
    : null;
  const garminFtp = userSettings?.garminFtp ?? null;
  const latestFTP = manualFtpWatts ?? garminFtp ?? p20BestFTP;
  const latestWeight = [...sorted].reverse().find(w => w.weight_kg != null)?.weight_kg ?? null;
  const wkg = latestFTP && latestWeight ? Math.round((latestFTP / latestWeight) * 100) / 100 : null;

  // FTP vs p20 estimate — compare the RESOLVED FTP (manual log wins) against the
  // best activity-derived p20 estimate. Previously this used the raw Garmin
  // profile FTP, which can be stale (111W vs a verified 211W) and produced a
  // nonsensical negative delta that confused the coach's narrative.
  const ftpTrend = latestFTP && p20BestFTP
    ? latestFTP - p20BestFTP   // positive = verified FTP above the p20 projection
    : cyclingWithFTP.length >= 2
      ? Math.max(...cyclingWithFTP.map(a => a.ftp as number)) - cyclingWithFTP[0].ftp!
      : null;

  // Running pace trend
  const runs90 = activities.filter(a =>
    a.activity_type === 'running' && a.distance_km > 1 &&
    a.duration_seconds > 0 && now - new Date(a.date).getTime() < 90 * 86400000);
  const avgRunPaceMinKm = runs90.length
    ? avg(runs90.map(a => (a.duration_seconds / 60) / a.distance_km))
    : null;

  // Sleep debt (vs 30d baseline)
  const sleepVals = last30Well.filter(w => w.sleep_hours != null).map(w => w.sleep_hours!);
  const sleepBaseline = sleepVals.length ? avg(sleepVals) : null;
  const sleepDebt7d = last7Well.filter(w => w.sleep_hours != null && sleepBaseline != null)
    .reduce((s, w) => s + (sleepBaseline! - w.sleep_hours!), 0);

  // HRV / stress trend
  const stressVals14 = nonNull(last14Well.map(w => w.stress_score));
  const stressVals7  = nonNull(last7Well.map(w => w.stress_score));
  const recovery7    = stressVals7.length  ? Math.round(100 - avg(stressVals7)!)  : null;
  const recovery14   = stressVals14.length ? Math.round(100 - avg(stressVals14)!) : null;

  // Longevity score components
  const latestVo2 = [...sorted].reverse().find(w => w.vo2max != null)?.vo2max ?? null;
  const avgRHR30  = avg(nonNull(last30Well.map(w => w.resting_hr)));

  // Coggan W/kg category
  const wkgCategory = !wkg ? 'Unknown'
    : wkg < 2.0 ? 'Untrained'
    : wkg < 2.5 ? 'Fair'
    : wkg < 3.2 ? 'Moderate'
    : wkg < 4.0 ? 'Good'
    : wkg < 5.0 ? 'Very Good' : 'Exceptional';

  const age = userSettings ? getAge(userSettings as UserSettings) : null;

  return {
    user_profile: {
      age,
      sex:          userSettings?.sex ?? null,
      height_cm:    userSettings?.heightCm ?? null,
      max_hr:       userSettings ? getMaxHR(userSettings as UserSettings) : null,
      threshold_hr: thresholdHR,
      threshold_hr_source: userSettings?.thresholdHR ? 'user-set' : 'estimated (85% of max HR)',
      steps_goal:   userSettings?.dailyStepsGoal ?? 10000,
      weight_kg:    latestWeight,
    },
    training: {
      period: '90 days',
      by_sport: summary90,
      weekly_tss_last_4_weeks: weeklyTSS,
      avg_weekly_tss:          summary90.avg_weekly_tss,
      current_ctl:             latestTL ? Math.round(latestTL.ctl) : null,
      current_atl:             latestTL ? Math.round(latestTL.atl) : null,
      current_tsb:             latestTL ? Math.round(latestTL.tsb * 10) / 10 : null,
      acwr:                    acwr ? Math.round(acwr * 100) / 100 : null,
      acwr_risk:               !acwr ? 'unknown' : acwr < 0.8 ? 'undertraining' : acwr <= 1.3 ? 'optimal' : acwr <= 1.5 ? 'elevated' : 'high',
      avg_run_pace_min_km:     avgRunPaceMinKm ? Math.round(avgRunPaceMinKm * 10) / 10 : null,
      note: 'TSS/CTL/ATL estimated from HR + duration where Garmin did not supply a TSS value (most walks/runs). Treat weekly_tss as approximate load, not device-reported.',
    },
    body_composition: {
      weight_kg:      latestBC?.weight_kg ?? latestWeight,
      body_fat_pct:   latestBC?.body_fat_pct ?? null,
      muscle_mass_kg: latestBC?.muscle_mass_kg ?? null,
      bone_mass_kg:   latestBC?.bone_mass_kg ?? null,
      body_water_pct: latestBC?.body_water_pct ?? null,
      trend_30d:      bcTrend,
      note:           'Garmin smart scale data',
    },
    wellness: {
      avg_resting_hr_14d:   avgRHR30 ? Math.round(avgRHR30) : null,
      avg_recovery_score_7d: recovery7,
      avg_recovery_score_14d: recovery14,
      avg_sleep_hours_14d:  last14Well.length
        ? avg(nonNull(last14Well.map(w => w.sleep_hours)))?.toFixed(1) : null,
      sleep_debt_7d_hours:  Math.round(sleepDebt7d * 10) / 10,
      avg_body_battery_7d:  avg(nonNull(last7Well.map(w => w.body_battery)))
        ? Math.round(avg(nonNull(last7Well.map(w => w.body_battery)))!) : null,
      avg_steps_7d:         avg(nonNull(last7Well.map(w => w.steps)))
        ? Math.round(avg(nonNull(last7Well.map(w => w.steps)))!) : null,
      note:                 'recovery_score = 100 - stress_score (Firstbeat HRV-derived)',
    },
    cycling_performance: {
      current_ftp_watts:   latestFTP,
      ftp_source:          manualFtpWatts ? 'manual log (user-verified)' : garminFtp ? 'Garmin/Zwift profile' : 'p20 × 0.95 estimate',
      garmin_ftp:          garminFtp,
      best_p20_ftp:        p20BestFTP,
      wkg,
      coggan_category:     wkgCategory,
      current_ftp_vs_best_recent_p20_estimate: ftpTrend !== null ? `${ftpTrend >= 0 ? '+' : ''}${ftpTrend}W` : null,
      note: 'Zone 2 rides deliberately use low power — FTP represents CAPACITY not recent ride intensity. current_ftp_vs_best_recent_p20_estimate = current_ftp_watts minus best_p20_ftp; do not subtract garmin_ftp from anything, it may be a stale device-profile value unrelated to current_ftp_watts.',
    },
    recovery: {
      todays_recovery_score:  recovery7,
      sleep_debt_7d:          Math.round(sleepDebt7d * 10) / 10,
      training_monotony_risk: !latestTL ? 'unknown'
        : (latestTL.atl / Math.max(latestTL.ctl, 1)) > 1.5 ? 'high' : 'normal',
    },
    longevity: {
      vo2max:              latestVo2,
      vo2max_context:      latestVo2 && age
        ? (() => {
            const r = vo2maxRating(latestVo2, age, (userSettings?.sex ?? 'male'));
            return `${r.category} for a ${age}-year-old ${userSettings?.sex ?? 'male'} (≈${r.percentile}th percentile, age/sex-adjusted ACSM norms)`;
          })()
        : null,
      resting_hr_30d_avg:  avgRHR30 ? Math.round(avgRHR30) : null,
      wkg_category:        wkgCategory,
      device:              'Garmin Vivosmart 5',
    },
  };
}

export async function generateWeeklySummary(
  activities: Activity[],
  wellness: WellnessRecord[],
  userSettings?: Partial<UserSettings>,
  manualFtpWatts?: number | null,
): Promise<AISummary> {
  const context = buildFullContext(activities, wellness, userSettings, manualFtpWatts);

  // Forced tool call guarantees schema-valid JSON — no fence-stripping or
  // regex extraction, which broke when the model wrapped output in ```json.
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: SYSTEM_PROMPT,
    tools: [{
      name: 'coaching_report',
      description: 'Record the structured coaching report',
      input_schema: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: '3-4 paragraph narrative: current fitness status, training load sustainability, health status, and overall trajectory',
          },
          recommendations: {
            type: 'array',
            items: { type: 'string' },
            description: 'Six items prefixed TRAINING/HEALTH: this week, next 4 weeks, sport-specific, sleep, body composition, recovery — each with specific target numbers',
          },
          injury_risks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific risk flags with the metric values that triggered them; empty if none',
          },
          longevity_insights: {
            type: 'array',
            items: { type: 'string' },
            description: 'VO2max percentile for age/sex, muscle mass & strength training, sleep/recovery as longevity levers',
          },
        },
        required: ['summary', 'recommendations', 'injury_risks', 'longevity_insights'],
      },
    }],
    tool_choice: { type: 'tool', name: 'coaching_report' },
    messages: [{
      role: 'user',
      content: `Analyse my complete fitness and health data below and produce a comprehensive coaching report via the coaching_report tool.

Data:
${JSON.stringify(context, null, 2)}

Be specific. Cite exact numbers. Give actionable targets not vague advice.`,
    }],
  });

  const toolBlock = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = (toolBlock?.input ?? {}) as any;

  return {
    summary:            typeof parsed.summary === 'string' ? parsed.summary : '',
    recommendations:    Array.isArray(parsed.recommendations)    ? parsed.recommendations    : [],
    injury_risks:       Array.isArray(parsed.injury_risks)       ? parsed.injury_risks       : [],
    longevity_insights: Array.isArray(parsed.longevity_insights) ? parsed.longevity_insights : [],
    generated_at:       new Date().toISOString(),
  };
}

export async function* streamChat(
  messages: Array<{ role: 'user' | 'assistant'; content: string; files?: { name: string; mediaType: string; data: string }[] }>,
  activities: Activity[],
  wellness: WellnessRecord[],
  userSettings?: Partial<UserSettings>,
  manualFtpWatts?: number | null,
  // Per-second HR/power summaries computed from activity_samples (NP, best efforts, HR zones, decoupling)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sampleSummaries?: any[],
): AsyncGenerator<string> {
  const context = buildFullContext(activities, wellness, userSettings, manualFtpWatts);

  const samplesSection = sampleSummaries && sampleSummaries.length > 0
    ? `\n\n## Per-Second HR & Power Analysis (Last ${sampleSummaries.length} Activities)
This is derived from raw second-by-second Garmin sensor data — use it for precise physiological insights.
Fields: normalized_power (NP, fatigue-weighted avg power), intensity_factor (NP/FTP), best_5min_power & best_20min_power (best sustained efforts), hr_zones_pct (% time in each HR zone by max-HR), aerobic_decoupling_pct (Power:HR drift first→second half; <5% = aerobically efficient, >10% = significant cardiac drift).
${JSON.stringify(sampleSummaries, null, 2)}`
    : '';

  const dataContext = `## Your Complete Fitness & Health Profile
${JSON.stringify(context, null, 2)}${samplesSection}`;

  // Build Anthropic message format — support text-only and text+file content
  const anthropicMessages = messages.map(m => {
    if (!m.files?.length || m.role === 'assistant') {
      return { role: m.role, content: m.content };
    }
    const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [];
    for (const file of m.files) {
      if (file.mediaType.startsWith('image/')) {
        contentBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: file.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: file.data },
        });
      } else {
        contentBlocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: file.data },
        } as Anthropic.Messages.ContentBlockParam);
      }
    }
    if (m.content.trim()) {
      contentBlocks.push({ type: 'text', text: m.content });
    }
    return { role: m.role as 'user', content: contentBlocks };
  });

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT + '\n\n' + dataContext,
    messages: anthropicMessages,
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      yield chunk.delta.text;
    }
  }
}
