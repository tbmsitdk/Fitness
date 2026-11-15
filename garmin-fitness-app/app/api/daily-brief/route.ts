import { NextRequest, NextResponse } from 'next/server';
import { askStructured } from '@/lib/ai';
import { loadCoachData, lastDays, daysAgo } from '@/lib/coach-data';
import { computeEarlyWarning } from '@/lib/early-warning';
import { BRIEF_SCHEMA, BRIEF_SYSTEM_PROMPT, buildBriefPrompt, parseBrief } from '@/lib/daily-brief';
import { briefFor, latestBrief, saveBrief } from '@/lib/daily-brief-db';
import { buildRawTables, homeDayAndTime, rawDataPromptSection } from '@/lib/raw-data';
import { computeReadiness } from '@/lib/readiness';
import { estimateTSS } from '@/lib/training-load';
import { loadMemorySection } from '@/lib/coach-memory-db';
import { loadExperimentsSection } from '@/lib/experiments-db';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// GET /api/daily-brief → the most recent brief, and whether it is today's.
export async function GET() {
  try {
    const brief = await latestBrief();
    return NextResponse.json({ brief, today: homeDayAndTime(new Date().toISOString()).day });
  } catch (e) {
    console.error('[daily-brief] GET', e);
    return NextResponse.json({ error: 'Could not load the brief' }, { status: 500 });
  }
}

// POST /api/daily-brief          → today's brief; generated once, then returned as stored
// POST /api/daily-brief?force=1  → regenerate (the sync does this, so the brief sees the new data)
export async function POST(req: NextRequest) {
  try {
    const data = await loadCoachData();
    const force = req.nextUrl.searchParams.get('force') === '1';
    if (!force) {
      const existing = await briefFor(data.today);
      if (existing) return NextResponse.json({ brief: existing, today: data.today, generated: false });
    }
    if (data.wellness.length === 0) {
      return NextResponse.json({ error: 'No wellness data yet.' }, { status: 404 });
    }

    // Training stress per home-timezone day, for the "hard training" explanation.
    const dailyLoad = new Map<string, number>();
    for (const a of lastDays(data.activities, 45, data.today)) {
      const day = homeDayAndTime(a.date, data.homeTimezone).day;
      dailyLoad.set(day, (dailyLoad.get(day) ?? 0) + estimateTSS(a));
    }

    // The warning is computed, not generated: same answer every time.
    const warning = computeEarlyWarning({
      wellness: data.wellness, today: data.today,
      nutritionLogs: data.nutritionLogs, travelLogs: data.travelLogs, dailyLoad,
    });

    const recent = buildRawTables({
      activities: lastDays(data.activities, 14, data.today),
      wellness: lastDays(data.wellness, 14, data.today),
      nutritionLogs: lastDays(data.nutritionLogs, 14, data.today),
      exerciseLogs: lastDays(data.exerciseLogs, 14, data.today),
      // Trips still open, or ended within the last three weeks.
      travelLogs: data.travelLogs.filter(t => !t.return_date || t.return_date.slice(0, 10) >= daysAgo(data.today, 21)),
      homeTimezone: data.homeTimezone,
    });
    const sorted = [...data.wellness].sort((a, b) => a.date.localeCompare(b.date));
    const readiness = computeReadiness(sorted);
    const [memory, experiments] = await Promise.all([
      loadMemorySection(),
      loadExperimentsSection(data.nutritionLogs, data.today),
    ]);

    const reply = await askStructured({
      system: BRIEF_SYSTEM_PROMPT,
      schema: BRIEF_SCHEMA,
      effort: 'low',
      prompt: buildBriefPrompt({
        today: data.today,
        weekday: WEEKDAYS[new Date(`${data.today}T12:00:00Z`).getUTCDay()],
        warning,
        recentData: rawDataPromptSection(recent),
        readiness: readiness ? { overall: Math.round(readiness.overall), band: readiness.band.label } : null,
        notes: [memory, experiments].filter(Boolean).join('\n\n') || undefined,
      }),
    });

    const brief = parseBrief(reply.text);
    await saveBrief(data.today, brief, warning, reply.model);
    return NextResponse.json({ brief: await briefFor(data.today), today: data.today, generated: true });
  } catch (e) {
    console.error('[daily-brief] POST', e);
    return NextResponse.json({ error: 'Could not write the brief' }, { status: 500 });
  }
}
