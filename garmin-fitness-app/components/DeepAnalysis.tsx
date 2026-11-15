'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, Clock, FlaskConical, Lightbulb, Loader2, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { MAX_QUESTION_LENGTH, type AnalysisChart, type AnalysisRun, type Confidence } from '@/lib/analysis';

const ACTIONS_HINT = 'GitHub → Actions → Coach Analysis → Run workflow';

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high:   'border-green-500/30 text-green-400',
  medium: 'border-amber-500/30 text-amber-400',
  low:    'border-border text-muted-foreground',
};

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">{title}</p>
      <ul className="space-y-1">{items.map((s, i) => (
        <li key={i} className="text-xs text-muted-foreground flex gap-2"><span>·</span><span>{s}</span></li>
      ))}</ul>
    </div>
  );
}

function RunCard({ run, onDelete }: { run: AnalysisRun; onDelete: (id: number) => void }) {
  const [charts, setCharts] = useState<AnalysisChart[] | null>(null);
  const [chartError, setChartError] = useState('');
  const result = run.result;
  const chartCount = result?.charts.length ?? 0;

  // Chart bytes are left out of the list; fetch them once for a finished run.
  useEffect(() => {
    if (run.status !== 'done' || chartCount === 0 || charts) return;
    let cancelled = false;
    fetch(`/api/analysis?id=${run.id}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(j => { if (!cancelled) setCharts((j.run?.result?.charts ?? []).filter((c: AnalysisChart) => c.data)); })
      .catch(() => { if (!cancelled) setChartError('The charts could not be loaded.'); });
    return () => { cancelled = true; };
  }, [run.id, run.status, chartCount, charts]);

  const title = run.kind === 'monthly' ? 'Monthly review' : (run.question ?? 'Deep analysis: strongest relationships in your data');

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-medium break-words">{title}</p>
            <p className="text-[11px] text-muted-foreground">
              {run.status === 'done' ? `Finished ${when(run.finished_at)}` : `Requested ${when(run.requested_at)}`}
              {run.model ? ` · ${run.model}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {run.status === 'queued'  && <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />Waiting</Badge>}
            {run.status === 'running' && <Badge variant="outline"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Running</Badge>}
            {run.status === 'failed'  && <Badge variant="outline" className="border-red-500/30 text-red-400"><AlertTriangle className="w-3 h-3 mr-1" />Failed</Badge>}
            {run.status === 'done'    && <Badge variant="outline" className="border-green-500/30 text-green-400"><CheckCircle2 className="w-3 h-3 mr-1" />Done</Badge>}
            {run.status !== 'running' && (
              <button onClick={() => onDelete(run.id)} title="Delete this analysis" aria-label="Delete this analysis"
                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {run.status === 'queued' && (
          <p className="text-xs text-muted-foreground">Waiting for the runner. If nothing happens within a few minutes, start it from {ACTIONS_HINT}.</p>
        )}
        {run.status === 'running' && (
          <p className="text-xs text-muted-foreground">Working through your data. This usually takes 5 to 15 minutes; the page checks by itself.</p>
        )}
        {run.status === 'failed' && <p className="text-xs text-red-400">{run.error ?? 'The run failed.'}</p>}

        {result && (
          <div className="space-y-4">
            <p className="text-sm">{result.headline}</p>

            {result.findings.length > 0 && (
              <div className="space-y-2">
                {result.findings.map((f, i) => (
                  <div key={i} className="rounded-md border border-border p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium">{f.title}</p>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <Badge variant="outline" className={CONFIDENCE_STYLE[f.confidence]}>{f.confidence} confidence</Badge>
                        <Badge variant="outline">{f.n > 0 ? `n = ${f.n}` : 'n not given'}</Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{f.detail}</p>
                    {f.evidence && <p className="text-[11px] text-muted-foreground/70 font-mono">{f.evidence}</p>}
                  </div>
                ))}
              </div>
            )}

            {chartCount > 0 && (
              <div className="space-y-3">
                {chartError && <p className="text-xs text-red-400">{chartError}</p>}
                {!charts && !chartError && <p className="text-xs text-muted-foreground">Loading {chartCount} chart{chartCount === 1 ? '' : 's'}…</p>}
                {charts?.map(c => (
                  <figure key={c.filename} className="space-y-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`data:image/png;base64,${c.data}`} alt={c.caption || c.filename} className="w-full rounded-md border border-border bg-white" />
                    {c.caption && <figcaption className="text-[11px] text-muted-foreground">{c.caption}</figcaption>}
                  </figure>
                ))}
              </div>
            )}

            <List title="Tested, but did not hold up" items={result.not_significant} />
            <List title="What to do next" items={result.next_steps} />
            <List title="Caveats" items={result.caveats} />

            {run.reasoning && (
              <details className="rounded-md border border-border/60 text-xs">
                <summary className="cursor-pointer select-none px-2 py-1.5 text-muted-foreground flex items-center gap-1.5">
                  <Lightbulb className="w-3 h-3" />How the analysis was done
                </summary>
                <p className="px-2 pb-2 whitespace-pre-wrap text-muted-foreground leading-relaxed">{run.reasoning}</p>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DeepAnalysis() {
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/analysis');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRuns(json.runs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll only while something is in flight.
  const pending = runs.some(r => r.status === 'queued' || r.status === 'running');
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [pending, load]);

  async function queue() {
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await fetch('/api/analysis', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setQuestion('');
      setNotice(json.dispatch === 'started'
        ? 'Started. Results usually arrive in 5 to 15 minutes.'
        : json.dispatch === 'failed'
          ? `Queued, but the runner could not be started from here. Start it from ${ACTIONS_HINT}.`
          : `Queued. Start the runner from ${ACTIONS_HINT}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    setError('');
    try {
      const res = await fetch(`/api/analysis?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRuns(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      setError(`Could not delete: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Deep analysis</span>
          </div>
          <p className="text-xs text-muted-foreground">
            The coach runs real statistics on your complete history — every day, not a summary — and reports what holds up,
            how sure it is, and what does not hold up. Ask a question, or leave it empty for the strongest relationships in your data.
            Each run costs a few dollars of model time.
          </p>
          <textarea
            value={question}
            onChange={e => setQuestion(e.target.value.slice(0, MAX_QUESTION_LENGTH))}
            rows={2}
            placeholder="e.g. Does alcohol still hurt my sleep once you account for weekends and travel?"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">{question.length}/{MAX_QUESTION_LENGTH}</span>
            <Button size="sm" onClick={queue} disabled={busy}>
              {busy ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5 mr-2" />}
              Run deep analysis
            </Button>
          </div>
          {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </CardContent>
      </Card>

      {loaded && runs.length === 0 && !error && (
        <p className="text-xs text-muted-foreground text-center py-6">
          No analyses yet. The monthly review appears here on the 1st of each month.
        </p>
      )}
      {runs.map(r => <RunCard key={r.id} run={r} onDelete={remove} />)}
    </div>
  );
}
