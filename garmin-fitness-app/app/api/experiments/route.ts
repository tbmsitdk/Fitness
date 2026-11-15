import { NextRequest, NextResponse } from 'next/server';
import { askStructured, buildFullContext } from '@/lib/ai';
import { loadCoachData, lastDays, daysAgo } from '@/lib/coach-data';
import {
  MAX_EXPERIMENT_DAYS, MIN_EXPERIMENT_DAYS, PROPOSALS_SCHEMA, adherence, cleanRule, experimentOutcomes,
  parseProposals,
} from '@/lib/experiments';
import {
  createExperiment, deleteExperiment, endExperiment, hasActiveExperiment, listExperiments, setCheckin,
} from '@/lib/experiments-db';
import { loadMemorySection } from '@/lib/coach-memory-db';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const idOf = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

const PROPOSE_SYSTEM = `You design small personal experiments for one person, from their own health and training data. An experiment changes ONE habit for two to four weeks so that its effect on recovery (sleep score, sleep hours, resting heart rate, stress, body battery) can be measured cleanly afterwards.

- Propose three, most promising first. Each must be something the data suggests matters for THIS person; say what in the data suggests it, with numbers.
- Prefer habits the app can check from the daily log: alcohol units, candy portions, savoury snacks, sugary drinks (rule_type max_per_day with rule_field and rule_value), time of last food (last_food_before with rule_time HH:MM), caffeine after 14:00 (no_late_caffeine). Use manual only for something the log cannot see, such as a fixed bedtime.
- For rule types that do not use a field, set rule_field to "none". Set rule_value to 0 and rule_time to "" when unused.
- Do not propose something already being tested or just finished (see the notes). Do not propose changing two things at once.
- The hypothesis states the expected direction and rough size. Keep each text field to a sentence or two.`;

// GET /api/experiments → every experiment with its adherence and before/during comparison
export async function GET() {
  try {
    const data = await loadCoachData();
    const list = await listExperiments(data.today);
    return NextResponse.json({
      today: data.today,
      experiments: list.map(exp => ({
        ...exp,
        adherence: adherence(exp, data.nutritionLogs, data.today),
        outcomes: exp.status === 'abandoned' ? [] : experimentOutcomes(exp, data.wellness, data.today),
      })),
    });
  } catch (e) {
    console.error('[experiments] GET', e);
    return NextResponse.json({ error: 'Could not load experiments' }, { status: 500 });
  }
}

// POST /api/experiments { action: 'propose' | 'start' | 'checkin' | 'end', ... }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const data = await loadCoachData();

    if (body.action === 'propose') {
      const context = buildFullContext(
        lastDays(data.activities, 90, data.today), lastDays(data.wellness, 90, data.today), undefined,
        data.manualFtpWatts, lastDays(data.exerciseLogs, 90, data.today), data.nutritionLogs, data.travelLogs,
      );
      const [memory, list] = await Promise.all([loadMemorySection(), listExperiments(data.today)]);
      const earlier = list.slice(0, 6).map(e => `- ${e.title} (${e.status}, ${e.start_date} to ${e.end_date})`).join('\n');
      const reply = await askStructured({
        system: PROPOSE_SYSTEM,
        schema: PROPOSALS_SCHEMA,
        effort: 'medium',
        prompt: `Today is ${data.today}. Propose three experiments.\n\nMy data, as computed by the app:\n${JSON.stringify(context, null, 2)}\n\nExperiments so far:\n${earlier || '(none)'}${memory ? `\n\n${memory}` : ''}`,
      });
      return NextResponse.json({ proposals: parseProposals(reply.text) });
    }

    if (body.action === 'start') {
      const rule = cleanRule(body.rule);
      const title = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
      const days = Number(body.duration_days);
      if (!rule || !title) return NextResponse.json({ error: 'A title and a valid rule are required' }, { status: 400 });
      if (!Number.isInteger(days) || days < MIN_EXPERIMENT_DAYS || days > MAX_EXPERIMENT_DAYS) {
        return NextResponse.json({ error: `Length must be ${MIN_EXPERIMENT_DAYS} to ${MAX_EXPERIMENT_DAYS} days` }, { status: 400 });
      }
      // Two experiments at once would each blur the other's result.
      if (await hasActiveExperiment(data.today)) {
        return NextResponse.json({ error: 'An experiment is already running. End it before starting another.' }, { status: 409 });
      }
      const start = isDate(body.start_date) && body.start_date >= daysAgo(data.today, 7) && body.start_date <= daysAgo(data.today, -14)
        ? body.start_date : data.today;
      const id = await createExperiment({
        title,
        hypothesis: typeof body.hypothesis === 'string' ? body.hypothesis.replace(/\s+/g, ' ').trim().slice(0, 400) : '',
        rule, start_date: start, end_date: daysAgo(start, -(days - 1)),
      });
      return NextResponse.json({ ok: true, id });
    }

    if (body.action === 'checkin') {
      const id = idOf(body.id);
      if (!id || !isDate(body.date) || typeof body.done !== 'boolean') {
        return NextResponse.json({ error: 'id, date and done are required' }, { status: 400 });
      }
      if (body.date > data.today) return NextResponse.json({ error: 'That day has not happened yet' }, { status: 400 });
      return NextResponse.json({ ok: await setCheckin(id, body.date, body.done) });
    }

    if (body.action === 'end') {
      const id = idOf(body.id);
      const status = body.status === 'abandoned' ? 'abandoned' : 'completed';
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
      return NextResponse.json({ ok: await endExperiment(id, status, data.today) });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    console.error('[experiments] POST', e);
    return NextResponse.json({ error: 'Something went wrong with the experiment' }, { status: 500 });
  }
}

// DELETE /api/experiments?id=3
export async function DELETE(req: NextRequest) {
  try {
    const id = idOf(req.nextUrl.searchParams.get('id'));
    if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    return NextResponse.json({ ok: await deleteExperiment(id) });
  } catch (e) {
    console.error('[experiments] DELETE', e);
    return NextResponse.json({ error: 'Could not delete the experiment' }, { status: 500 });
  }
}
