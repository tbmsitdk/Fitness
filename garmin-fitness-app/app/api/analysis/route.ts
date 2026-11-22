import { NextRequest, NextResponse } from 'next/server';
import { cleanQuestion, MAX_QUEUED_RUNS } from '@/lib/analysis';
import { sampleCoverage, countQueued, deleteRun, getRun, listRuns, queueRun } from '@/lib/analysis-db';

export const dynamic = 'force-dynamic';

const WORKFLOW_FILE = 'coach-analysis.yml';

/**
 * Starts the GitHub Actions workflow that performs the run. Optional: without
 * GITHUB_DISPATCH_TOKEN and GITHUB_REPO the run simply waits in the queue
 * until the workflow is started by hand or by its schedule.
 */
async function dispatchWorkflow(): Promise<'started' | 'not_configured' | 'failed'> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO; // "owner/name"
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return 'not_configured';
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    });
    if (!res.ok) console.error('[analysis] workflow dispatch failed', res.status);
    return res.ok ? 'started' : 'failed';
  } catch (e) {
    console.error('[analysis] workflow dispatch error', e);
    return 'failed';
  }
}

// GET /api/analysis        → recent runs, without chart bytes
// GET /api/analysis?id=12  → one run, with its charts
export async function GET(req: NextRequest) {
  try {
    const idParam = req.nextUrl.searchParams.get('id');
    if (idParam !== null) {
      const id = Number(idParam);
      if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
      const run = await getRun(id);
      return run ? NextResponse.json({ run }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const [runs, coverage] = await Promise.all([listRuns(), sampleCoverage().catch(() => null)]);
    return NextResponse.json({ runs, coverage });
  } catch (e) {
    console.error('[analysis] GET', e);
    return NextResponse.json({ error: 'Could not load analyses' }, { status: 500 });
  }
}

// POST /api/analysis { question? } → queue a deep analysis
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const question = cleanQuestion((body as { question?: unknown }).question);
    // Each run costs real money; a stuck button must not queue a dozen.
    if (await countQueued() >= MAX_QUEUED_RUNS) {
      return NextResponse.json(
        { error: `${MAX_QUEUED_RUNS} analyses are already waiting. Let them run, or delete one, first.` },
        { status: 429 },
      );
    }
    // 'audit' is the cross-check of the dashboard's own numbers; it takes no question.
    const kind = (body as { kind?: unknown }).kind === 'audit' ? 'audit' : 'deep';
    const run = await queueRun(kind, kind === 'audit' ? null : question);
    const dispatch = await dispatchWorkflow();
    return NextResponse.json({ run, dispatch });
  } catch (e) {
    console.error('[analysis] POST', e);
    return NextResponse.json({ error: 'Could not queue the analysis' }, { status: 500 });
  }
}

// DELETE /api/analysis?id=12
export async function DELETE(req: NextRequest) {
  try {
    const id = Number(req.nextUrl.searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    return NextResponse.json({ ok: await deleteRun(id) });
  } catch (e) {
    console.error('[analysis] DELETE', e);
    return NextResponse.json({ error: 'Could not delete the analysis' }, { status: 500 });
  }
}
