// Runs queued deep analyses and the monthly review. Started by
// .github/workflows/coach-analysis.yml — these runs take minutes, longer than
// a Vercel function may live, so they happen here and the app only shows the
// result.
//
//   1. ask the app for the next queued run and its data
//   2. upload the raw tables to a code-execution sandbox
//   3. let Claude analyse them with real Python, at high effort
//   4. download any charts, delete every uploaded file, post the result back
//
// Environment: APP_URL, SYNC_SECRET, ANTHROPIC_API_KEY, and optionally
// VERCEL_BYPASS_SECRET, ANALYSIS_SCHEDULE=monthly, ANALYSIS_EFFORT,
// ANALYSIS_TASK_BUDGET, ANALYSIS_MAX_RUNS.

import Anthropic, { toFile } from '@anthropic-ai/sdk';
import {
  ANALYSIS_SCHEMA, ANALYSIS_SYSTEM_PROMPT, MAX_CHARTS, MAX_CHART_BYTES,
  buildAnalysisPrompt, collectOutputFileIds, isPng, parseAnalysisResult, safeChartName,
  type AnalysisChart, type AnalysisKind, type AnalysisResult,
} from '@/lib/analysis';
import { readReply } from '@/lib/coach-report';
import { COACH_MODEL } from '@/lib/models';

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

interface Job {
  run: { id: number; kind: AnalysisKind; question: string | null };
  tables: Record<string, string>;
  aggregates: unknown;
  memory: string | null;
  previousReview: string | null;
  today: string;
}

function env(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`✗ ${name} is not set.`);
    process.exit(1);
  }
  return v;
}

const APP_URL = env('APP_URL').replace(/\/+$/, '');
const SYNC_SECRET = env('SYNC_SECRET');
env('ANTHROPIC_API_KEY');

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const EFFORT: Effort = EFFORTS.includes(process.env.ANALYSIS_EFFORT as Effort)
  ? (process.env.ANALYSIS_EFFORT as Effort) : 'high';
// Tokens Claude may generate and read back from the sandbox in one run. It is
// told the budget and paces itself to finish inside it.
const TASK_BUDGET = Math.max(20_000, Number(process.env.ANALYSIS_TASK_BUDGET) || 300_000);
const MAX_RUNS = Math.max(1, Number(process.env.ANALYSIS_MAX_RUNS) || 3);
const MAX_CONTINUATIONS = 8;

const client = new Anthropic();

const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${SYNC_SECRET}`,
};
if (process.env.VERCEL_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = process.env.VERCEL_BYPASS_SECRET;

async function nextJob(): Promise<Job | null> {
  const schedule = process.env.ANALYSIS_SCHEDULE === 'monthly' ? '?schedule=monthly' : '';
  const res = await fetch(`${APP_URL}/api/analysis/job${schedule}`, { headers });
  if (res.status === 204) return null;
  // Say WHICH failure this is: "could not reach the app" and "the app said no"
  // need different fixes.
  if (res.status === 401) throw new Error('The app rejected SYNC_SECRET (401). Check the secret matches Vercel.');
  if (!res.ok) throw new Error(`The app answered ${res.status} to the job request.`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    throw new Error('The app returned a page, not JSON — probably the Vercel login wall. Check VERCEL_BYPASS_SECRET and APP_URL.');
  }
  return await res.json() as Job;
}

async function report(body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${APP_URL}/api/analysis/job`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`The app answered ${res.status} when storing the result.`);
}

async function analyse(job: Job): Promise<{ result: AnalysisResult; reasoning: string; model: string }> {
  const uploaded: string[] = [];
  const generated: string[] = [];
  try {
    // 1. The tables go to the sandbox as files, not into the prompt.
    const names = Object.keys(job.tables);
    if (names.length === 0) throw new Error('The app sent no data tables.');
    for (const name of names) {
      const file = await client.files.upload({
        file: await toFile(Buffer.from(job.tables[name], 'utf8'), name, { type: 'text/csv' }),
      });
      uploaded.push(file.id);
      console.log(`  ↑ ${name} (${Math.round(job.tables[name].length / 1024)} KB)`);
    }

    const prompt = buildAnalysisPrompt({
      kind: job.run.kind,
      question: job.run.question,
      files: names,
      aggregates: JSON.stringify(job.aggregates, null, 2),
      memory: job.memory ?? undefined,
      previousReview: job.previousReview ?? undefined,
      today: job.today,
    });

    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...uploaded.map(id => ({ type: 'container_upload' as const, file_id: id })),
      ],
    }];

    // 2. One long turn. The server pauses it every so often (pause_turn); it is
    //    resumed by sending the assistant's content straight back.
    const blocks: Anthropic.Beta.Messages.BetaContentBlock[] = [];
    let response: Anthropic.Beta.Messages.BetaMessage | null = null;
    let container: string | undefined;
    let inputTokens = 0;
    let outputTokens = 0;

    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      response = await client.beta.messages.stream({
        model: COACH_MODEL,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01', 'task-budgets-2026-03-13'],
        fallbacks: 'default',
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: {
          effort: EFFORT,
          task_budget: { type: 'tokens', total: TASK_BUDGET },
          format: { type: 'json_schema', schema: ANALYSIS_SCHEMA },
        },
        system: ANALYSIS_SYSTEM_PROMPT,
        tools: [{ type: 'code_execution_20260521', name: 'code_execution' }],
        ...(container ? { container } : {}),
        messages,
      }).finalMessage();

      blocks.push(...response.content);
      container = response.container?.id ?? container;
      inputTokens += response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0);
      outputTokens += response.usage.output_tokens;
      console.log(`  … turn ${i + 1}: ${response.stop_reason}, ${response.usage.output_tokens} output tokens`);

      if (response.stop_reason !== 'pause_turn') break;
      if (i === MAX_CONTINUATIONS) throw new Error(`The analysis was still running after ${MAX_CONTINUATIONS + 1} turns.`);
      // Replace, don't append twice: user turn + everything the assistant has said so far.
      messages.splice(1, messages.length - 1, { role: 'assistant', content: blocks as Anthropic.Beta.Messages.BetaContentBlockParam[] });
    }
    if (!response) throw new Error('No response from the model.');

    // 3. Throws on a refusal or a cut-off instead of storing half a report.
    const reply = readReply(response);
    const result = parseAnalysisResult(reply.text);
    const reasoning = readReply({ stop_reason: 'end_turn', content: blocks }).reasoning;

    // 4. Charts. Only small, safely named, genuine PNGs are kept.
    generated.push(...collectOutputFileIds(blocks));
    const captions = new Map(result.charts.map(c => [safeChartName(c.filename), c.caption]));
    const charts: AnalysisChart[] = [];
    for (const id of generated) {
      if (charts.length >= MAX_CHARTS) break;
      const meta = await client.files.retrieveMetadata(id);
      const name = safeChartName(meta.filename);
      if (!name || meta.size_bytes > MAX_CHART_BYTES) {
        console.log(`  – skipped ${meta.filename} (${meta.size_bytes} bytes)`);
        continue;
      }
      const bytes = Buffer.from(await (await client.files.download(id)).arrayBuffer());
      if (!isPng(bytes) || bytes.length > MAX_CHART_BYTES) continue;
      // A re-saved chart keeps its name: the later file wins.
      const existing = charts.findIndex(c => c.filename === name);
      const chart = { filename: name, caption: captions.get(name) ?? '', data: bytes.toString('base64') };
      if (existing >= 0) charts[existing] = chart; else charts.push(chart);
      console.log(`  ↓ ${name} (${Math.round(bytes.length / 1024)} KB)`);
    }

    console.log(`  ✓ ${result.findings.length} findings, ${charts.length} charts · ${inputTokens} in / ${outputTokens} out tokens · served by ${response.model}`);
    return { result: { ...result, charts }, reasoning, model: response.model };
  } finally {
    // This is health data. Nothing uploaded or generated is left behind.
    for (const id of [...uploaded, ...generated]) {
      try { await client.files.delete(id); } catch { /* already gone, or not ours to delete */ }
    }
  }
}

async function main() {
  console.log(`Coach analysis · model ${COACH_MODEL} · effort ${EFFORT} · task budget ${TASK_BUDGET} tokens`);
  let done = 0;
  let failed = 0;
  for (let i = 0; i < MAX_RUNS; i++) {
    const job = await nextJob();
    if (!job) break;
    const label = job.run.kind === 'monthly' ? 'monthly review' : `deep analysis${job.run.question ? `: "${job.run.question}"` : ''}`;
    console.log(`\nRun #${job.run.id} — ${label}`);
    try {
      const { result, reasoning, model } = await analyse(job);
      await report({ id: job.run.id, result, reasoning, model });
      done++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`  ✗ ${message}`);
      // Tell the app, so the run shows as failed with a reason instead of hanging.
      try { await report({ id: job.run.id, error: message }); } catch (e2) { console.error(`  ✗ could not report the failure: ${e2}`); }
    }
  }
  console.log(done + failed === 0 ? '\nNothing queued.' : `\n${done} finished, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
