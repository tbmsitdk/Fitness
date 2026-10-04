'use client';
import { useState, useEffect, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Activity, WellnessRecord } from '@/types';
import { useDataVersion } from '@/lib/data-refresh';
import { estimateTSS } from '@/lib/training-load';
import {
  circadianEvents, tripDates, zonesCrossed, shiftDirection, addDays, daysBetween,
  type TravelLog,
} from '@/lib/travel';
import { travelKpis, tripImpacts } from '@/lib/travel-analysis';
import { OUTCOMES, type DayMetrics } from '@/lib/nutrition-analysis';
import ExpandableCard from '@/components/ExpandableCard';
import TravelRecovery from './TravelRecovery';

const EAST = '#d95926';
const WEST = '#3987e5';
const SAME = 'hsl(240 5% 45%)';
const EMPTY = 'hsl(240 3.7% 10%)';
const HRV = OUTCOMES.find(o => o.key === 'hrv')!;

interface Props {
  allWellness: WellnessRecord[];
  allActivities: Activity[];
  cutoff: Date;
  thresholdHR: number;
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-xl font-bold font-mono leading-tight">{value}</p>
      <p className="text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}

export default function TravelSection({ allWellness, allActivities, cutoff, thresholdHR }: Props) {
  const [trips, setTrips] = useState<TravelLog[] | null>(null);
  const dataVersion = useDataVersion();

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/travel?t=${Date.now()}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => { if (!cancelled) setTrips(Array.isArray(d.trips) ? d.trips : []); })
      .catch(() => { if (!cancelled) setTrips([]); });
    return () => { cancelled = true; };
  }, [dataVersion]);

  const metricsByDate = useMemo(() => {
    const tssByDate = new Map<string, number>();
    for (const a of allActivities) {
      const d = a.date.slice(0, 10);
      tssByDate.set(d, (tssByDate.get(d) ?? 0) + estimateTSS(a, thresholdHR));
    }
    const m = new Map<string, DayMetrics>();
    for (const w of allWellness) {
      const date = w.date.slice(0, 10);
      m.set(date, {
        date, hrv: w.hrv_rmssd, restingHr: w.resting_hr, sleepHours: w.sleep_hours,
        sleepScore: w.sleep_score, bodyBattery: w.body_battery, stress: w.stress_score,
        tss: tssByDate.get(date) ?? null,
      });
    }
    return m;
  }, [allWellness, allActivities, thresholdHR]);

  const p = (n: number) => String(n).padStart(2, '0');
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();
  const periodStart = (() => { const d = new Date(cutoff); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();

  // Analysis uses EVERY trip — sample size is scarce and a trip outside the
  // selected period still carries a valid lesson. Only the KPIs and the strip
  // are period-scoped.
  const events = useMemo(() => (trips ?? []).flatMap(circadianEvents), [trips]);
  const kpis = useMemo(() => travelKpis(trips ?? [], periodStart, today), [trips, periodStart, today]);

  // Per-trip HRV impact, newest first — the concrete "what did this one cost me"
  // tripImpacts truncates each window at the next shift, so back-to-back trips
  // never inherit each other's dips.
  const impacts = useMemo(() => tripImpacts(events, metricsByDate, HRV)
    .filter(i => i.event.leg === 'outbound' && i.event.direction !== 'none' && i.baseline != null)
    .sort((a, b) => b.event.date.localeCompare(a.event.date))
    .slice(0, 8),
  [events, metricsByDate]);

  const strip = useMemo(() => {
    const span = Math.max(1, daysBetween(periodStart, today) + 1);
    const days = Array.from({ length: span }, (_, i) => addDays(periodStart, i));
    const byDate = new Map<string, { dir: string; dest: string }>();
    for (const t of trips ?? []) {
      const z = zonesCrossed(t.home_utc_offset, t.dest_utc_offset);
      const dir = shiftDirection(z);
      for (const d of tripDates(t, today)) byDate.set(d, { dir, dest: t.destination });
    }
    return { days, byDate };
  }, [trips, periodStart, today]);

  if (!trips) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <ExpandableCard title="Travel & Timezones">
        {() => trips.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-28 gap-1.5 text-center px-6">
            <p className="text-sm text-muted-foreground">No trips logged</p>
            <p className="text-[11px] text-muted-foreground/60 max-w-md">
              Add trips under Data → Travel. Backfill past ones too — you already have the recovery
              data, so logging history gives an answer straight away rather than in six months.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Kpi label="Trips" value={String(kpis.trips)}
                sub={`${kpis.eastTrips} east · ${kpis.westTrips} west`} />
              <Kpi label="Days away" value={String(kpis.daysAway)}
                sub={`${kpis.daysAwayPct}% of this period`} />
              <Kpi label="Zones crossed" value={String(kpis.totalZonesCrossed)}
                sub={`biggest single shift ${kpis.maxZones}`} />
              <Kpi label="Days adapting" value={String(kpis.daysInTransition)}
                sub="estimated body-clock shift" />
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Away days</p>
              <div className="flex" style={{ gap: strip.days.length > 120 ? 1 : 2 }}>
                {strip.days.map(d => {
                  const hit = strip.byDate.get(d);
                  const bg = !hit ? EMPTY : hit.dir === 'east' ? EAST : hit.dir === 'west' ? WEST : SAME;
                  return (
                    <div key={d} className="flex-1 min-w-0"
                      title={`${format(parseISO(d), 'EEE d MMM')} · ${hit ? hit.dest : 'home'}`}
                      style={{ height: 12, borderRadius: 2, background: bg }} />
                  );
                })}
              </div>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                <div style={{ width: 10, height: 10, borderRadius: 2, background: EAST }} /><span>east</span>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: WEST }} /><span>west</span>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: SAME }} /><span>same zone</span>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: EMPTY }} /><span>home</span>
              </div>
            </div>
          </div>
        )}
      </ExpandableCard>

      <ExpandableCard title="Jet Lag · Recovery Curve">
        {(expanded) => (
          <TravelRecovery events={events} metricsByDate={metricsByDate}
            height={expanded ? 420 : undefined} />
        )}
      </ExpandableCard>

      {impacts.length > 0 && (
        <ExpandableCard title="Cost of Each Trip · HRV">
          {() => (
            <div className="space-y-2">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-1 text-left font-medium">Trip</th>
                      <th className="px-2 py-1 text-right font-medium">Shift</th>
                      <th className="px-2 py-1 text-right font-medium">Baseline</th>
                      <th className="px-2 py-1 text-right font-medium">Worst</th>
                      <th className="px-2 py-1 text-right font-medium">Back to normal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impacts.map(i => (
                      <tr key={`${i.event.date}-${i.event.destination}`} className="border-t border-border/50">
                        <td className="px-2 py-1.5 text-[11px]">
                          {i.event.destination}
                          <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">
                            {format(parseISO(i.event.date), 'd MMM yy')}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-[11px] font-mono text-right whitespace-nowrap">
                          <span style={{ color: i.event.direction === 'east' ? EAST : WEST }}>
                            {Math.abs(i.event.zones)} {i.event.direction}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-[11px] font-mono text-right text-muted-foreground">
                          {i.baseline!.toFixed(1)}
                        </td>
                        <td className="px-2 py-1.5 text-[11px] font-mono text-right">
                          {i.worstDeviation != null ? (
                            <span className={i.worstDeviation < 0 ? 'text-red-400' : 'text-green-400'}>
                              {i.worstDeviation > 0 ? '+' : ''}{i.worstDeviation.toFixed(1)}
                              <span className="text-muted-foreground/60 ml-1">
                                d{i.worstOffset}
                              </span>
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-[11px] font-mono text-right text-muted-foreground">
                          {i.recoveredAfterDays != null ? `${i.recoveredAfterDays} d` : 'not within 14 d'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-muted-foreground/60 italic leading-relaxed">
                Baseline is your own mean HRV in the 14 days before departure. &ldquo;Worst&rdquo; is
                the largest drop in the two weeks after arrival, with the day it fell on.
                &ldquo;Back to normal&rdquo; is the first day within 5% of baseline that also held
                the next day — one good day inside a bad week is noise, not recovery.
                A trip is listed only if its pre-departure window had at least four HRV readings.
              </p>
            </div>
          )}
        </ExpandableCard>
      )}
    </>
  );
}
