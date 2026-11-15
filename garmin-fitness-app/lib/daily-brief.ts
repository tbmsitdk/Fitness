// The morning brief: one short note after each Garmin sync. Pure helpers —
// the model call is in lib/ai.ts, storage in lib/daily-brief-db.ts.

import type { EarlyWarning } from '@/lib/early-warning';

export interface DailyBrief {
  /** One sentence: the state of things this morning. */
  headline: string;
  /** How the night and the last few days went, with numbers. */
  recovery: string;
  /** What to do today. */
  today: string;
  /** Anything unusual worth an eye. Empty string when there is nothing. */
  watch: string;
}

export interface StoredBrief {
  date: string;
  brief: DailyBrief;
  warning: EarlyWarning;
  model: string | null;
  created_at: string;
}

export const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'One sentence on how things stand this morning.' },
    recovery: { type: 'string', description: 'Two or three sentences on last night and the last few days, citing the actual numbers.' },
    today:    { type: 'string', description: 'Two or three sentences: what to do today, concretely.' },
    watch:    { type: 'string', description: 'One or two sentences on anything unusual. Empty string if nothing is.' },
  },
  required: ['headline', 'recovery', 'today', 'watch'],
  additionalProperties: false,
} as const;

export const BRIEF_SYSTEM_PROMPT = `You write a short morning brief for one person from their own training and health data. They read it on their phone before deciding what to do today.

- Plain words, their real numbers, no preamble and no sign-off. Each field is a few sentences at most.
- "today" must be something they can act on: train hard, train easy, rest, go to bed earlier, and why.
- The early-warning result was computed by code and is authoritative on WHETHER something is off. Do not raise an alarm it did not raise, and do not play down one it did. Your job is to word it.
- If the warning lists likely explanations (alcohol, travel, hard training), say so: a known cause is not a mystery illness. If it lists none and the level is watch or warning, say plainly that the pattern often comes before getting ill or overreaching, and suggest an easy day.
- If the data is stale, say which day it is from and do not describe it as this morning.
- You are a coach, not a doctor: never diagnose. For anything that sounds medical, suggest seeing one.
- An empty cell in the tables means not recorded, never zero. stress_score is HRV-derived and higher is worse.`;

export interface BriefPromptInput {
  today: string;
  weekday: string;
  warning: EarlyWarning;
  /** Last two weeks of raw rows as a prompt section. */
  recentData: string;
  readiness?: { overall: number; band: string } | null;
  /** Coach memory and any active experiment. */
  notes?: string;
}

export function buildBriefPrompt(input: BriefPromptInput): string {
  const parts = [
    `Today is ${input.weekday} ${input.today}. Write this morning's brief.`,
    `Early-warning check (computed by the app):\n${JSON.stringify(input.warning, null, 2)}`,
  ];
  if (input.readiness) parts.push(`The app's readiness score today: ${input.readiness.overall}/100 (${input.readiness.band}).`);
  parts.push(input.recentData);
  if (input.notes) parts.push(input.notes);
  return parts.join('\n\n');
}

/** Parses the model's JSON. Throws rather than store an empty brief. */
export function parseBrief(text: string): DailyBrief {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Brief is not JSON: "${text.slice(0, 120)}"`);
  }
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const brief = { headline: str(o?.headline), recovery: str(o?.recovery), today: str(o?.today), watch: str(o?.watch) };
  if (!brief.headline || !brief.today) throw new Error('Brief is missing its headline or its advice for today.');
  return brief;
}
