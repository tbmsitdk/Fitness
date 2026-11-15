'use client';
import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Check, FlaskConical, Loader2, Sparkles, Trash2, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useDataVersion } from '@/lib/data-refresh';
import {
  describeRule, experimentAnalysisQuestion, type Adherence, type Experiment, type ExperimentProposal,
  type OutcomeComparison, type OutcomeVerdict,
} from '@/lib/experiments';

type Row = Experiment & { adherence: Adherence; outcomes: OutcomeComparison[] };

const VERDICT_STYLE: Record<OutcomeVerdict, string> = {
  better: 'text-green-400', worse: 'text-red-400', 'no clear change': 'text-muted-foreground', 'not enough data': 'text-muted-foreground/60',
};
const short = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function Outcomes({ outcomes, running }: { outcomes: OutcomeComparison[]; running: boolean }) {
  if (outcomes.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Next-morning recovery, {running ? 'so far' : 'during'} vs the weeks before
      </p>
      <table className="w-full text-xs">
        <tbody>
          {outcomes.map(o => (
            <tr key={o.key} className="border-t border-border/50">
              <td className="py-1 pr-2">{o.label}</td>
              <td className="py-1 pr-2 text-muted-foreground tabular-nums">
                {o.before === null ? '—' : `${o.before}${o.unit} → ${o.during}${o.unit}`}
              </td>
              <td className={cn('py-1 pr-2 tabular-nums', VERDICT_STYLE[o.verdict])}>
                {o.change !== null && o.verdict !== 'no clear change' ? `${o.change > 0 ? '+' : ''}${o.change}${o.unit} · ` : ''}{o.verdict}
              </td>
              <td className="py-1 text-right text-muted-foreground/70 tabular-nums">n {o.nBefore}/{o.nDuring}{o.singleStratum ? '*' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-muted-foreground/70">
        Weekend nights are compared with weekend nights and weekday nights with weekday nights. n = mornings before/during.
        {outcomes.some(o => o.singleStratum) ? ' * only one kind of night had enough data.' : ''}
        {running ? ' Do not read much into this before the end.' : ''}
      </p>
    </div>
  );
}

export default function Experiments() {
  const dataVersion = useDataVersion();
  const [rows, setRows] = useState<Row[]>([]);
  const [today, setToday] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [proposals, setProposals] = useState<ExperimentProposal[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/experiments');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRows(json.experiments ?? []); setToday(json.today ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoaded(true); }
  }, []);
  useEffect(() => { load(); }, [load, dataVersion]);

  async function act(key: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(key); setError(''); setNotice('');
    try {
      const res = await fetch('/api/experiments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally { setBusy(''); }
  }

  async function propose() {
    const json = await act('propose', { action: 'propose' });
    if (json) setProposals((json.proposals as ExperimentProposal[]) ?? []);
  }
  async function start(p: ExperimentProposal) {
    const json = await act(`start-${p.title}`, { action: 'start', title: p.title, hypothesis: p.hypothesis, rule: p.rule, duration_days: p.duration_days });
    if (json) { setProposals(null); await load(); }
  }
  async function checkin(id: number, date: string, done: boolean) {
    if (await act(`checkin-${id}`, { action: 'checkin', id, date, done })) await load();
  }
  async function end(id: number, status: 'completed' | 'abandoned') {
    if (await act(`end-${id}`, { action: 'end', id, status })) await load();
  }
  async function remove(id: number) {
    setError('');
    try {
      const res = await fetch(`/api/experiments?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows(prev => prev.filter(r => r.id !== id));
    } catch (e) { setError(`Could not delete: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function analyse(exp: Experiment) {
    setBusy(`analyse-${exp.id}`); setError(''); setNotice('');
    try {
      const res = await fetch('/api/analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: experimentAnalysisQuestion(exp) }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setNotice(json.dispatch === 'started'
        ? 'Deep analysis started. The result appears under Deep Analysis.'
        : 'Deep analysis queued. Start it from GitHub → Actions → Coach Analysis → Run workflow; the result appears under Deep Analysis.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  }

  const active = rows.find(r => r.status === 'active');

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Experiments</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Change one habit for two to four weeks, then compare your recovery with the weeks before. This gives a far cleaner answer than
            looking back at ordinary weeks. One experiment runs at a time, and days you do not log count as unknown, not as kept.
          </p>
          {!active && (
            <Button size="sm" onClick={propose} disabled={busy !== ''}>
              {busy === 'propose' ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-2" />}
              Suggest experiments from my data
            </Button>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
          {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
        </CardContent>
      </Card>

      {proposals && proposals.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No usable suggestions came back. Try again.</p>}
      {proposals?.map(p => (
        <Card key={p.title} className="border-blue-500/20 bg-blue-500/5">
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium">{p.title}</p>
              <Badge variant="outline">{p.duration_days} days</Badge>
            </div>
            <p className="text-xs"><span className="font-medium">Rule: </span><span className="text-muted-foreground">{describeRule(p.rule)}</span></p>
            <p className="text-xs"><span className="font-medium">Expecting: </span><span className="text-muted-foreground">{p.hypothesis}</span></p>
            {p.why && <p className="text-xs"><span className="font-medium">Why: </span><span className="text-muted-foreground">{p.why}</span></p>}
            <div className="flex justify-end">
              <Button size="sm" onClick={() => start(p)} disabled={busy !== ''}>
                {busy === `start-${p.title}` ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : null}Start today
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {loaded && rows.length === 0 && !proposals && !error && (
        <p className="text-xs text-muted-foreground text-center py-6">No experiments yet.</p>
      )}

      {rows.map(r => {
        const a = r.adherence;
        const running = r.status === 'active';
        const dayNo = Math.min(a.daysTotal, a.daysElapsed);
        return (
          <Card key={r.id}>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium break-words">{r.title}</p>
                  <p className="text-[11px] text-muted-foreground">{describeRule(r.rule)} · {short(r.start_date)} to {short(r.end_date)}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {running && <Badge variant="outline" className="border-blue-500/30 text-blue-400">Day {dayNo} of {a.daysTotal}</Badge>}
                  {r.status === 'completed' && <Badge variant="outline" className="border-green-500/30 text-green-400">Finished</Badge>}
                  {r.status === 'abandoned' && <Badge variant="outline">Stopped</Badge>}
                  {!running && (
                    <button onClick={() => remove(r.id)} title="Delete this experiment" aria-label="Delete this experiment"
                      className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {r.hypothesis && <p className="text-xs text-muted-foreground">{r.hypothesis}</p>}

              <p className="text-xs">
                <span className="font-medium">Kept: </span>
                <span className="text-muted-foreground">
                  {a.percent === null ? 'no days logged yet' : `${a.kept} of ${a.kept + a.broken} logged days (${a.percent}%)`}
                  {a.unknown > 0 ? ` · ${a.unknown} ${a.unknown === 1 ? 'day' : 'days'} not logged` : ''}
                </span>
              </p>
              {running && a.unknownDays.length > 0 && r.rule.type !== 'manual' && (
                <p className="text-[11px] text-amber-400">Not logged: {a.unknownDays.slice(-5).map(short).join(', ')}. Log those days (a 0 counts) so they can be counted.</p>
              )}

              {running && r.rule.type === 'manual' && today >= r.start_date && today <= r.end_date && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Today:</span>
                  <Button size="sm" variant={r.checkins[today] === true ? 'default' : 'outline'} onClick={() => checkin(r.id, today, true)} disabled={busy !== ''}>
                    <Check className="w-3.5 h-3.5 mr-1.5" />Kept it
                  </Button>
                  <Button size="sm" variant={r.checkins[today] === false ? 'default' : 'outline'} onClick={() => checkin(r.id, today, false)} disabled={busy !== ''}>
                    <X className="w-3.5 h-3.5 mr-1.5" />Did not
                  </Button>
                </div>
              )}

              <Outcomes outcomes={r.outcomes} running={running} />

              <div className="flex flex-wrap justify-end gap-2">
                {running && <Button size="sm" variant="ghost" onClick={() => end(r.id, 'abandoned')} disabled={busy !== ''}>Stop without a result</Button>}
                {running && <Button size="sm" variant="outline" onClick={() => end(r.id, 'completed')} disabled={busy !== ''}>End now and compare</Button>}
                {r.status === 'completed' && (
                  <Button size="sm" variant="outline" onClick={() => analyse(r)} disabled={busy !== ''}>
                    {busy === `analyse-${r.id}` ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5 mr-2" />}
                    Analyse in depth
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
