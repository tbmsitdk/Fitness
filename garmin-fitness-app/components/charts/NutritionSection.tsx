'use client';
import { useState, useEffect, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { Activity, WellnessRecord } from '@/types';
import { useDataVersion } from '@/lib/data-refresh';
import { estimateTSS } from '@/lib/training-load';
import type { NutritionLog } from '@/lib/nutrition';
import type { DayMetrics } from '@/lib/nutrition-analysis';
import ExpandableCard from '@/components/ExpandableCard';
import NutritionCalendar from './NutritionCalendar';
import NutritionImpact from './NutritionImpact';
import NutritionEffects from './NutritionEffects';

interface Props {
  allWellness: WellnessRecord[];
  allActivities: Activity[];
  cutoff: Date;
  thresholdHR: number;
}

/**
 * Owns the nutrition fetch and the day-indexed outcome table, then renders the
 * three cards that read from them.
 *
 * Note it takes the FULL wellness and activity history, not the period-filtered
 * slice: an intake on the last day of the window needs the NEXT day's recovery
 * numbers, which would otherwise sit just outside the filter.
 */
export default function NutritionSection({ allWellness, allActivities, cutoff, thresholdHR }: Props) {
  const [logs, setLogs] = useState<NutritionLog[] | null>(null);
  const dataVersion = useDataVersion();

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/nutrition?days=3650&t=${Date.now()}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => { if (!cancelled) setLogs(Array.isArray(d.logs) ? d.logs : []); })
      .catch(() => { if (!cancelled) setLogs([]); });
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
        date,
        hrv: w.hrv_rmssd,
        restingHr: w.resting_hr,
        sleepHours: w.sleep_hours,
        sleepScore: w.sleep_score,
        bodyBattery: w.body_battery,
        stress: w.stress_score,
        tss: tssByDate.get(date) ?? null,
      });
    }
    return m;
  }, [allWellness, allActivities, thresholdHR]);

  // Only the calendar is period-scoped; the analysis cards deliberately use
  // every logged day, because they need all the sample size they can get.
  const inPeriod = useMemo(
    () => (logs ?? []).filter(l => new Date(l.date) >= cutoff),
    [logs, cutoff],
  );

  if (!logs) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <ExpandableCard title="Food & Drink · Intake">
        {() => <NutritionCalendar logs={inPeriod} cutoff={cutoff} />}
      </ExpandableCard>

      <ExpandableCard title="Alcohol · Impact on Recovery">
        {(expanded) => (
          <NutritionImpact logs={logs} metricsByDate={metricsByDate}
            exposure="alcohol" height={expanded ? 360 : undefined} />
        )}
      </ExpandableCard>

      <ExpandableCard title="Sugar · Impact on Recovery">
        {(expanded) => (
          <NutritionImpact logs={logs} metricsByDate={metricsByDate}
            exposure="candy" height={expanded ? 360 : undefined} />
        )}
      </ExpandableCard>

      <ExpandableCard title="What Moves the Needle">
        {() => <NutritionEffects logs={logs} metricsByDate={metricsByDate} />}
      </ExpandableCard>
    </>
  );
}
