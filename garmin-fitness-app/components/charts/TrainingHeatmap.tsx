'use client';
import { useMemo, useState, useRef } from 'react';
import { Activity } from '@/types';
import { estimateTSS, isTrainingSession } from '@/lib/training-load';
import { format, parseISO, isLeapYear, getDay, startOfYear, addDays } from 'date-fns';

const CELL = 13;   // px per cell
const GAP  = 2;    // px gap

const TSS_COLORS = [
  { min: 0,   max: 1,   color: 'hsl(240 3.7% 12%)' },
  { min: 1,   max: 30,  color: '#14532d' },
  { min: 30,  max: 60,  color: '#16a34a' },
  { min: 60,  max: 100, color: '#22c55e' },
  { min: 100, max: Infinity, color: '#4ade80' },
];

function tssColor(tss: number) {
  return TSS_COLORS.find(b => tss >= b.min && tss < b.max)?.color ?? TSS_COLORS[0].color;
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

interface DayData {
  tss: number;
  acts: Array<{ type: string; title: string; distance_km: number; duration_seconds: number }>;
}

interface Props {
  activities: Activity[];
  /** Estimated TSS from manually-logged routine days, keyed YYYY-MM-DD.
   *  Merged in so logged strength/mobility work shows up as training too. */
  extraTssByDate?: Map<string, number>;
  height?: number;
}

export default function TrainingHeatmap({ activities, extraTssByDate }: Props) {
  // Build year list from data
  const years = useMemo(() => {
    const ys = new Set(activities.map(a => new Date(a.date).getFullYear()));
    ys.add(new Date().getFullYear());
    return Array.from(ys).sort((a, b) => b - a);
  }, [activities]);

  const [year, setYear] = useState(() => new Date().getFullYear());
  const [tooltip, setTooltip] = useState<{ x: number; y: number; date: string; data: DayData } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build date → DayData map. This is the TRAINING heatmap, so casual walks
  // (and sub-20-min sessions) are excluded — a day of only dog-walks stays grey.
  const dayMap = useMemo(() => {
    const map = new Map<string, DayData>();
    for (const a of activities) {
      if (!isTrainingSession(a)) continue;
      const key = new Date(a.date).toISOString().split('T')[0];
      const ex = map.get(key) ?? { tss: 0, acts: [] };
      ex.tss += estimateTSS(a);
      ex.acts.push({
        type: a.activity_type,
        title: a.title || a.activity_type,
        distance_km: a.distance_km,
        duration_seconds: a.duration_seconds,
      });
      map.set(key, ex);
    }
    // Merge in manually-logged routine days
    for (const [date, tss] of extraTssByDate ?? []) {
      if (tss <= 0) continue;
      const ex = map.get(date) ?? { tss: 0, acts: [] };
      ex.tss += tss;
      ex.acts.push({ type: 'routine', title: 'Strength & mobility routine', distance_km: 0, duration_seconds: 0 });
      map.set(date, ex);
    }
    return map;
  }, [activities, extraTssByDate]);

  // Build grid for selected year
  const { cells, monthLabels, totalTSS, activeDays } = useMemo(() => {
    const jan1 = startOfYear(new Date(year, 0, 1));
    const days = isLeapYear(jan1) ? 366 : 365;
    // getDay: 0=Sun…6=Sat; we want Mon=0
    const startDow = (getDay(jan1) + 6) % 7; // Mon-based offset

    const totalCells = startDow + days;
    const totalWeeks = Math.ceil(totalCells / 7);

    // cols[col][row] = { date, data } | null
    const cols: Array<Array<{ date: string; data: DayData | null }>> = [];
    for (let col = 0; col < totalWeeks; col++) {
      const rows: Array<{ date: string; data: DayData | null }> = [];
      for (let row = 0; row < 7; row++) {
        const dayIdx = col * 7 + row - startDow;
        if (dayIdx < 0 || dayIdx >= days) {
          rows.push({ date: '', data: null });
        } else {
          const d = addDays(jan1, dayIdx);
          const key = format(d, 'yyyy-MM-dd');
          rows.push({ date: key, data: dayMap.get(key) ?? null });
        }
      }
      cols.push(rows);
    }

    // Month labels: find first column where the month starts
    const monthCols: { month: string; col: number }[] = [];
    let lastMonth = -1;
    for (let col = 0; col < cols.length; col++) {
      for (const cell of cols[col]) {
        if (!cell.date) continue;
        const m = parseISO(cell.date).getMonth();
        if (m !== lastMonth) {
          monthCols.push({ month: format(parseISO(cell.date), 'MMM'), col });
          lastMonth = m;
          break;
        }
      }
    }

    // Compute stats for the selected year
    let tssSum = 0, activeCount = 0;
    for (const [k, v] of dayMap) {
      if (k.startsWith(`${year}-`)) { tssSum += v.tss; activeCount++; }
    }

    return { cells: cols, monthLabels: monthCols, totalTSS: Math.round(tssSum), activeDays: activeCount };
  }, [year, dayMap]);

  const DAYS_SHORT = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];

  return (
    <div className="space-y-3">
      {/* Year selector + stats */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1">
          {years.map(y => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={`text-xs px-2 py-0.5 rounded border transition ${y === year ? 'bg-foreground text-background border-foreground font-semibold' : 'border-border text-muted-foreground hover:border-foreground/40'}`}
            >
              {y}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground ml-2">{activeDays} active days · {totalTSS} TSS</span>
      </div>

      {/* Grid */}
      <div ref={containerRef} className="overflow-x-auto" style={{ position: 'relative' }}>
        <div style={{ display: 'inline-block', position: 'relative' }}>
          {/* Month labels */}
          <div style={{ display: 'flex', marginLeft: 28, marginBottom: 4, position: 'relative', height: 14 }}>
            {monthLabels.map(({ month, col }) => (
              <div
                key={month}
                style={{
                  position: 'absolute',
                  left: 28 + col * (CELL + GAP),
                  fontSize: 10,
                  color: 'hsl(240 5% 64.9%)',
                  whiteSpace: 'nowrap',
                }}
              >
                {month}
              </div>
            ))}
          </div>

          {/* Day labels + grid */}
          <div style={{ display: 'flex', gap: 0 }}>
            {/* Day of week labels */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: GAP, marginRight: 4 }}>
              {DAYS_SHORT.map((d, i) => (
                <div key={i} style={{ height: CELL, fontSize: 9, color: 'hsl(240 5% 50%)', lineHeight: `${CELL}px`, textAlign: 'right', width: 22 }}>
                  {d}
                </div>
              ))}
            </div>

            {/* Columns */}
            <div style={{ display: 'flex', gap: GAP }}>
              {cells.map((col, ci) => (
                <div key={ci} style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
                  {col.map((cell, ri) => {
                    const tss = cell.data?.tss ?? 0;
                    const isEmpty = !cell.date;
                    return (
                      <div
                        key={ri}
                        style={{
                          width: CELL,
                          height: CELL,
                          borderRadius: 2,
                          backgroundColor: isEmpty ? 'transparent' : tssColor(tss),
                          cursor: cell.data ? 'pointer' : 'default',
                          opacity: isEmpty ? 0 : 1,
                        }}
                        onMouseEnter={e => {
                          if (!cell.date || !cell.data) return;
                          const rect = containerRef.current?.getBoundingClientRect();
                          const target = (e.target as HTMLElement).getBoundingClientRect();
                          setTooltip({
                            x: target.left - (rect?.left ?? 0) + CELL / 2,
                            y: target.top - (rect?.top ?? 0),
                            date: cell.date,
                            data: cell.data,
                          });
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tooltip */}
        {tooltip && (
          <div
            style={{
              position: 'absolute',
              left: tooltip.x + 8,
              top: tooltip.y - 8,
              zIndex: 50,
              pointerEvents: 'none',
            }}
            className="bg-popover border border-border rounded-lg p-2.5 shadow-lg text-xs min-w-[160px]"
          >
            <p className="font-semibold mb-1">{format(parseISO(tooltip.date), 'EEE d MMM yyyy')}</p>
            <p className="text-muted-foreground mb-1">{Math.round(tooltip.data.tss)} TSS</p>
            {tooltip.data.acts.map((a, i) => (
              <p key={i} className="text-[10px] text-muted-foreground">
                {a.type} · {a.distance_km > 0 ? `${a.distance_km.toFixed(1)} km` : formatDuration(a.duration_seconds)}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>Less</span>
        {TSS_COLORS.map((b, i) => (
          <div key={i} style={{ width: CELL, height: CELL, borderRadius: 2, backgroundColor: b.color }} />
        ))}
        <span>More</span>
        <span className="ml-2">· colour = training stress (TSS) · walks excluded</span>
      </div>
    </div>
  );
}
