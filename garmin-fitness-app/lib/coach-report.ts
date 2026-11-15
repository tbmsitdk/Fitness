// Pure helpers for reading model replies. No SDK import, so they are testable
// without an API key and safe to share with scripts.

import type { AISummary } from '@/types';

/** JSON schema for the coaching report. Structured outputs guarantee it parses. */
export const COACHING_REPORT_SCHEMA = {
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
  additionalProperties: false,
} as const;

/** The pieces of a finished response the coach cares about. */
export interface ModelReply {
  text: string;
  /** Summarised reasoning, when the model returned any. */
  reasoning: string;
}

/**
 * Pulls the text and the reasoning summary out of a response, and FAILS LOUDLY
 * on the two endings that would otherwise render as an empty or half-written
 * report: a refusal and a max_tokens cut-off.
 */
export function readReply(response: {
  stop_reason: string | null;
  content: ReadonlyArray<{ type: string; text?: string; thinking?: string }>;
}): ModelReply {
  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined this request (stop_reason: refusal).');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('The model ran out of output tokens before finishing (stop_reason: max_tokens).');
  }
  const text = response.content
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text as string)
    .join('');
  const reasoning = response.content
    .filter(b => b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim() !== '')
    .map(b => (b.thinking as string).trim())
    .join('\n\n');
  return { text, reasoning };
}

/** Parses the coaching report JSON. Throws rather than return a blank report. */
export function parseCoachingReport(text: string): Omit<AISummary, 'generated_at'> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Coach returned text that is not JSON: "${text.slice(0, 120)}"`);
  }
  const o = parsed as Record<string, unknown>;
  if (typeof o?.summary !== 'string' || o.summary.trim() === '') {
    throw new Error('Coach returned a report with no summary.');
  }
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    summary:            o.summary,
    recommendations:    list(o.recommendations),
    injury_risks:       list(o.injury_risks),
    longevity_insights: list(o.longevity_insights),
  };
}
