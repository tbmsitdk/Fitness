'use client';
import { useMemo } from 'react';
import type { NutritionLog } from '@/lib/nutrition';
import {
  rankEffects, STANDARD_EXPOSURES, MIN_BUCKET_N, type DayMetrics, type EffectSize,
} from '@/lib/nutrition-analysis';

interface Props {
  logs: NutritionLog[];
  metricsByDate: Map<string, DayMetrics>;
  limit?: number;
}

/** Cohen's conventions — named so the number means something to a reader. */
function magnitude(d: number): string {
  const a = Math.abs(d);
  if (a >= 0.8) return 'large';
  if (a >= 0.5) return 'moderate';
  if (a >= 0.2) return 'small';
  return 'negligible';
}

function Row({ e }: { e: EffectSize }) {
  const d = e.d!;
  const pct = Math.min(100, Math.abs(d) / 1.2 * 100);
  return (
    <tr className="border-t border-border/50">
      <td className="px-2 py-1.5 text-[11px]">{e.exposureLabel}</td>
      <td className="px-2 py-1.5 text-[11px] text-muted-foreground">{e.outcome.label}</td>
      <td className="px-2 py-1.5 text-right font-mono text-[11px] whitespace-nowrap">
        <span className={e.worse ? 'text-red-400' : 'text-green-400'}>
          {e.delta! > 0 ? '+' : ''}{e.delta!.toFixed(e.outcome.decimals)}
        </span>
        <span className="text-muted-foreground">{e.outcome.unit ? ` ${e.outcome.unit}` : ''}</span>
      </td>
      <td className="px-2 py-1.5 w-28">
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
          <div className="h-full rounded-full"
            style={{ width: `${pct}%`, background: e.worse ? '#d55181' : '#199e70' }} />
        </div>
      </td>
      <td className="px-2 py-1.5 text-[10px] text-muted-foreground whitespace-nowrap">
        {magnitude(d)}
      </td>
      <td className="px-2 py-1.5 text-right text-[10px] text-muted-foreground whitespace-nowrap">
        {e.nExposed}/{e.nBaseline}
        {e.unreliable && <span className="text-amber-400 ml-1">⚠</span>}
      </td>
    </tr>
  );
}

export default function NutritionEffects({ logs, metricsByDate, limit = 12 }: Props) {
  const ranked = useMemo(
    () => rankEffects(logs, metricsByDate, STANDARD_EXPOSURES),
    [logs, metricsByDate],
  );

  const reliable = ranked.filter(e => !e.unreliable);
  const shown = (reliable.length > 0 ? reliable : ranked).slice(0, limit);

  if (shown.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-28 gap-1.5 text-center px-6">
        <p className="text-sm text-muted-foreground">Nothing to rank yet</p>
        <p className="text-[11px] text-muted-foreground/60 max-w-md">
          This needs logged days both with and without each habit, plus recovery data the
          morning after. Roughly six weeks of logging gets the first reliable comparisons.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-1 text-left font-medium">Habit</th>
              <th className="px-2 py-1 text-left font-medium">Affects</th>
              <th className="px-2 py-1 text-right font-medium">Difference</th>
              <th className="px-2 py-1 text-left font-medium">Size</th>
              <th className="px-2 py-1 text-left font-medium"></th>
              <th className="px-2 py-1 text-right font-medium">n with/without</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e, i) => <Row key={`${e.exposureLabel}-${e.outcome.key}-${i}`} e={e} />)}
          </tbody>
        </table>
      </div>

      {reliable.length === 0 && (
        <p className="text-[10px] text-amber-400/80 italic">
          Every comparison here has fewer than {MIN_BUCKET_N} days on one side. These are shown so
          you can see the direction things are pointing, but they are not yet reliable numbers.
        </p>
      )}

      <p className="text-[10px] text-muted-foreground/60 italic leading-relaxed">
        Ranked by effect size (Cohen&apos;s d), which makes metrics on different scales comparable —
        10 ms of HRV and 3 bpm of resting HR are not otherwise. Differences are measured the
        morning after.{' '}
        <strong>Treat this as a list of things worth testing deliberately, not as settled findings.</strong>{' '}
        Scanning many habits against many outcomes will throw up some hits by chance; the way to
        confirm one is to change that single habit for a fortnight and watch the same number.
      </p>
    </div>
  );
}
