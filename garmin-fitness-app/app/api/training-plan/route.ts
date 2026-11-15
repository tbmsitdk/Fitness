import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { PLAN_MODEL } from '@/lib/models';

export interface TrainingSession {
  day: string;
  type: string;
  duration_min: number;
  description: string;
  tss_estimate: number;
}

export interface TrainingWeek {
  week: number;
  theme: string;
  tss_target: number;
  sessions: TrainingSession[];
}

export interface TrainingPlan {
  goal: string;
  ftp_input: number;
  weeks: TrainingWeek[];
  key_principles: string[];
}

interface RequestBody {
  ftp: number;
  daysPerWeek: number;
  goal: 'base' | 'ftp' | 'race';
  weeksAvailable?: number;
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const maxDuration = 120;

const TRAINING_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    goal: { type: 'string' },
    ftp_input: { type: 'number' },
    weeks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          week: { type: 'integer' },
          theme: { type: 'string' },
          tss_target: { type: 'number' },
          sessions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                day: { type: 'string' },
                type: { type: 'string' },
                duration_min: { type: 'number' },
                description: { type: 'string' },
                tss_estimate: { type: 'number' },
              },
              required: ['day', 'type', 'duration_min', 'description', 'tss_estimate'],
              additionalProperties: false,
            },
          },
        },
        required: ['week', 'theme', 'tss_target', 'sessions'],
        additionalProperties: false,
      },
    },
    key_principles: { type: 'array', items: { type: 'string' } },
  },
  required: ['goal', 'ftp_input', 'weeks', 'key_principles'],
  additionalProperties: false,
} as const;

const GOAL_LABELS: Record<string, string> = {
  base: 'Base Fitness & Aerobic Foundation',
  ftp:  'Raise FTP / Threshold Power',
  race: 'Race Preparation (Zwift Racing)',
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as RequestBody;
    const { ftp, daysPerWeek, goal, weeksAvailable = 4 } = body;

    if (!ftp || ftp < 50 || ftp > 600) {
      return NextResponse.json({ error: 'Invalid FTP value (must be 50–600 W)' }, { status: 400 });
    }
    if (!daysPerWeek || daysPerWeek < 2 || daysPerWeek > 6) {
      return NextResponse.json({ error: 'daysPerWeek must be 2–6' }, { status: 400 });
    }

    const goalLabel = GOAL_LABELS[goal] ?? 'Base Fitness';

    const prompt = `You are an expert cycling coach specialising in Zwift training. Create a ${weeksAvailable}-week training plan for an amateur cyclist.

Athlete profile:
- FTP: ${ftp} W
- Training days per week: ${daysPerWeek}
- Goal: ${goalLabel}
- Platform: Zwift (all sessions are indoor)

Requirements:
- Each week should have exactly ${daysPerWeek} sessions and ${7 - daysPerWeek} rest days
- Progress logically over ${weeksAvailable} weeks (periodization)
- Include a variety of session types appropriate for the goal
- Week 4 should be a recovery/consolidation week (lower TSS)
- All workouts must be doable on Zwift with specific workout descriptions
- TSS estimates must be realistic (Zone 2 60 min ≈ 40–55 TSS, threshold 45 min ≈ 65–80 TSS)
- Descriptions should be specific: intervals, durations, watts as % of FTP

Return the plan in this structure:
{
  "goal": "${goalLabel}",
  "ftp_input": ${ftp},
  "weeks": [
    {
      "week": 1,
      "theme": "e.g. Base building",
      "tss_target": 250,
      "sessions": [
        {
          "day": "Monday",
          "type": "Zone 2 endurance",
          "duration_min": 60,
          "description": "Steady Zone 2 at 56–75% FTP. Keep HR conversational. Use Zwift free ride or a flat route.",
          "tss_estimate": 50
        }
      ]
    }
  ],
  "key_principles": ["3 bullet points explaining the core training philosophy for this plan"]
}`;

    // Structured outputs: the schema guarantees parseable JSON, which the old
    // "return only JSON" instruction plus a regex could only hope for.
    const resp = await client.messages.create({
      model: PLAN_MODEL,
      max_tokens: 16000,
      output_config: { format: { type: 'json_schema', schema: TRAINING_PLAN_SCHEMA } },
      system: 'You are an expert cycling coach.',
      messages: [{ role: 'user', content: prompt }],
    });

    if (resp.stop_reason === 'refusal' || resp.stop_reason === 'max_tokens') {
      return NextResponse.json({ error: `Plan generation stopped early (${resp.stop_reason})` }, { status: 500 });
    }
    const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
    if (!text) {
      return NextResponse.json({ error: 'Claude returned no plan' }, { status: 500 });
    }

    const plan = JSON.parse(text) as TrainingPlan;
    return NextResponse.json({ plan });
  } catch (err) {
    console.error('[training-plan]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
