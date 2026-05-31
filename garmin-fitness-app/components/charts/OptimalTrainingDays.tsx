'use client';
import { useMemo } from 'react';
import { TrainingLoadForecast } from '@/lib/training-load';
import { format, parseISO, subDays, addDays, startOfDay } from 'date-fns';

interface Props {
  trainingLoad: TrainingLoadForecast[];
}

function tsbColor(tsb: number, projected: boolean): string {
  const alpha = projected ? '66' : 'CC';
  if (tsb < -20) return `#EF4444${alpha}`;      // red — overreached
  if (tsb <= 5)  return `#F59E0B${alpha}`;      // amber — building
  if (tsb <= 25) return `#22C55E${alpha}`;      // green — optimal
  return `#3B82F6${alpha}`;                      // blue — detraining
}

function tsbLabel(tsb: number): { text: string; color: string } {
  if (tsb < -20) return { text: 'Overreached', color: '#EF4444' };
  if (tsb <= 5)  return { text: 'Building', color: '#F59E0B' };
  if (tsb <= 25) return { text: 'Optimal', color: '#22C55E' };
  return { text: 'Detraining', color: '#3B82F6' };
}

export default function OptimalTrainingDays({ trainingLoad }: Props) {
  const { days, todayTSB, todayStatus } = useMemo(() => {
    const tsbMap = new Map<string, { tsb: number; projected: boolean }>();
    for (const d of trainingLoad) {
      tsbMap.set(d.date, { tsb: d.tsb, projected: d.projected });
    }

    const today = startOfDay(new Date());
    const start = subDays(today, 59); // 60 days back
    const end = addDays(today, 14);   // 14 days forward

    const result: { date: string; tsb: number | null; projected: boolean; isToday: boolean }[] = [];
    const cur = new Date(start);
    while (cur <= end) {
      const dateStr = format(cur, 'yyyy-MM-dd');
      const entry = tsbMap.get(dateStr);
      result.push({
        date: dateStr,
        tsb: entry?.tsb ?? null,
        projected: entry?.projected ?? false,
        isToday: dateStr === format(today, 'yyyy-MM-dd'),
      });
      cur.setDate(cur.getDate() + 1);
    }

    // Pad to start on Monday
    const firstDow = parseISO(result[0].date).getDay(); // 0=Sun
    const mondayOffset = firstDow === 0 ? 6 : firstDow - 1;
    type DayCell = { date: string; tsb: number | null; projected: boolean; isToday: boolean };
    const padding: DayCell[] = Array.from({ length: mondayOffset }, () => ({
      date: '',
      tsb: null as number | null,
      projected: false,
      isToday: false,
    }));
    const padded: DayCell[] = padding.concat(result);

    const todayEntry = result.find(d => d.isToday);
    const todayTSB = todayEntry?.tsb ?? null;
    const todayStatus = todayTSB !== null ? tsbLabel(todayTSB) : null;

    return { days: padded, todayTSB, todayStatus };
  }, [trainingLoad]);

  const LEGEND = [
    { label: 'Overreached', color: '#EF4444', range: '< -20' },
    { label: 'Building', color: '#F59E0B', range: '-20 to +5' },
    { label: 'Optimal', color: '#22C55E', range: '+5 to +25' },
    { label: 'Detraining', color: '#3B82F6', range: '> +25' },
  ];

  const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="space-y-3">
      {/* Today's status */}
      {todayStatus && todayTSB !== null && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
          <div>
            <p className="text-[10px] tracking-widest uppercase text-muted-foreground">Today&#39;s TSB</p>
            <p className="text-2xl font-bold font-mono" style={{ color: todayStatus.color }}>
              {todayTSB > 0 ? '+' : ''}{todayTSB.toFixed(1)}
            </p>
          </div>
          <div>
            <span
              className="text-sm font-medium px-2 py-0.5 rounded"
              style={{ background: todayStatus.color + '22', color: todayStatus.color }}
            >
              {todayStatus.text}
            </span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {LEGEND.map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ background: l.color }} />
            <span className="text-[10px] text-muted-foreground">{l.label} (TSB {l.range})</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm border border-dashed border-muted-foreground opacity-50" />
          <span className="text-[10px] text-muted-foreground">Forecast (14d)</span>
        </div>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-1">
        {DOW_LABELS.map(d => (
          <div key={d} className="text-center text-[9px] text-muted-foreground font-medium pb-1">{d}</div>
        ))}
        {days.map((day, i) => {
          if (!day.date) {
            return <div key={`pad-${i}`} className="h-8 rounded-sm" />;
          }
          const tsb: number | null = day.tsb;
          const bg = tsb !== null ? tsbColor(tsb, day.projected) : 'hsl(240 3.7% 13%)';
          const dom = parseISO(day.date).getDate();
          const titleStr = tsb !== null
            ? `${day.date}: TSB ${tsb > 0 ? '+' : ''}${tsb.toFixed(1)}${day.projected ? ' (forecast)' : ''}`
            : day.date;
          return (
            <div
              key={day.date}
              title={titleStr}
              className="h-8 rounded-sm flex items-center justify-center relative cursor-default"
              style={{
                background: bg,
                outline: day.isToday ? '2px solid hsl(0 0% 98%)' : undefined,
                outlineOffset: '1px',
                borderStyle: day.projected ? 'dashed' : 'solid',
                borderWidth: 1,
                borderColor: day.projected ? 'hsl(240 3.7% 25%)' : 'transparent',
              }}
            >
              <span className="text-[9px] font-medium text-white/80">{dom}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground/60 italic">
        Colors show Training Stress Balance (TSB = fitness − fatigue). Lighter / dashed cells = 14-day forecast.
      </p>
    </div>
  );
}
