'use client';
import { useMemo } from 'react';
import { WellnessRecord } from '@/types';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Activity, Wind, Footprints, Droplets, Brain, MoveUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  wellness: WellnessRecord[];
  height?: number;
}

// ── Mini sparkline ────────────────────────────────────────────────────────────

function Spark({
  data,
  dataKey,
  color,
  refLine,
}: {
  data: { date: string; v: number | null }[];
  dataKey: string;
  color: string;
  refLine?: number;
}) {
  const points = data.filter(d => d.v != null);
  if (points.length < 3) return <div className="h-10 flex items-center text-xs text-muted-foreground/50">—</div>;
  return (
    <ResponsiveContainer width="100%" height={40}>
      <LineChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <Line type="monotone" dataKey="v" stroke={color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
        {refLine != null && <ReferenceLine y={refLine} stroke={color} strokeDasharray="3 3" strokeOpacity={0.4} />}
        <Tooltip
          contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, padding: '4px 8px', fontSize: 11 }}
          labelFormatter={l => String(l).slice(0, 10)}
          formatter={(v: number) => [v.toFixed(1), dataKey]}
        />
        <XAxis dataKey="date" hide />
        <YAxis hide domain={['auto', 'auto']} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Metric tile ────────────────────────────────────────────────────────────────

function Tile({
  icon,
  label,
  latest,
  unit,
  avg30,
  trend,    // +/- number, optional
  trendGoodDir, // 'up' | 'down' — which direction is good
  spark,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  latest: number | null;
  unit: string;
  avg30: number | null;
  trend?: number | null;
  trendGoodDir?: 'up' | 'down';
  spark: React.ReactNode;
  note?: string;
}) {
  // fmt: safely format a value — guards against strings/NaN reaching toFixed
  const fmt = (v: number | null | undefined): string => {
    if (v == null) return '—';
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return n.toFixed(n >= 10 ? 0 : 1);
  };

  if (latest == null && avg30 == null) return null;

  const trendColor = trend == null ? '' : (
    (trendGoodDir === 'up'   && trend > 0) ||
    (trendGoodDir === 'down' && trend < 0)
      ? 'text-green-400' : trend === 0 ? 'text-muted-foreground' : 'text-amber-400'
  );

  const display = latest != null ? fmt(latest) : fmt(avg30);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon}{label}
        </div>
        {trend != null && (
          <span className={`text-[10px] ${trendColor}`}>
            {trend > 0 ? '+' : ''}{fmt(trend)} 30d
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums">{display}</span>
        <span className="text-xs text-muted-foreground">{unit}</span>
        {avg30 != null && latest != null && (
          <span className="text-[10px] text-muted-foreground ml-auto">avg {fmt(avg30)}</span>
        )}
      </div>
      {spark}
      {note && <p className="text-[10px] text-muted-foreground/60">{note}</p>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function AppleHealthVitals({ wellness, height }: Props) {
  const sorted = useMemo(() =>
    [...wellness].sort((a, b) => a.date.localeCompare(b.date)),
  [wellness]);

  const now = Date.now();
  const last30 = sorted.filter(w => now - new Date(w.date).getTime() < 30 * 86400000);
  const last90 = sorted.filter(w => now - new Date(w.date).getTime() < 90 * 86400000);

  const avg = (arr: (number | null)[]): number | null => {
    const v = arr.filter((x): x is number => x != null);
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  };

  // Coerce undefined/string/NaN → null. Always returns a real JS number or null.
  // Must force Number() conversion because Postgres DECIMAL cols arrive as strings
  // even after coerceWellness in some edge cases.
  const safe = (v: number | null | undefined): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  };

  // Check if we have ANY Apple Health mobility data at all
  const hasAHData = sorted.some(w =>
    safe(w.flights_climbed) != null || safe(w.respiratory_rate) != null ||
    safe(w.walking_asymmetry_pct) != null || safe(w.walking_speed) != null ||
    safe(w.walking_double_support_pct) != null || safe(w.oxygen_saturation) != null ||
    safe(w.mindful_minutes) != null
  );

  if (!hasAHData) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No Apple Health mobility data yet — re-upload your Apple Health export to populate stairs, gait, breathing rate and more.
        </CardContent>
      </Card>
    );
  }

  // Latest values — using safe() to guard against pre-migration undefined fields
  const latest = (key: keyof WellnessRecord) =>
    safe([...sorted].reverse().find(w => safe(w[key] as number | null | undefined) != null)?.[key] as number | null | undefined);

  // 30-day trend (last value minus first value in window)
  const trend30 = (key: keyof WellnessRecord): number | null => {
    const vals = last30.map(w => safe(w[key] as number | null | undefined)).filter((v): v is number => v != null);
    if (vals.length < 4) return null;
    return Math.round((vals[vals.length - 1] - vals[0]) * 10) / 10;
  };

  // Spark data helpers
  const sparkData = (key: keyof WellnessRecord, window: WellnessRecord[]) =>
    window.map(w => ({ date: w.date, v: safe(w[key] as number | null | undefined) }));

  // Flights
  const totalFlights30 = last30.reduce((s, w) => s + (safe(w.flights_climbed) ?? 0), 0);
  const validFlights30 = last30.filter(w => safe(w.flights_climbed) != null).length;
  const avgFlights30   = validFlights30 > 0 ? Math.round(totalFlights30 / validFlights30) : null;

  // Mindful minutes
  const totalMindful30 = last30.reduce((s, w) => s + (safe(w.mindful_minutes) ?? 0), 0);

  // Respiratory rate
  const latestRespRate = latest('respiratory_rate');
  const avgRespRate30  = avg(last30.map(w => safe(w.respiratory_rate)));
  const trendResp      = trend30('respiratory_rate');

  // Walking asymmetry — lower is better
  const latestAsymm = latest('walking_asymmetry_pct');
  const avgAsymm30  = avg(last30.map(w => safe(w.walking_asymmetry_pct)));
  const trendAsymm  = trend30('walking_asymmetry_pct');

  // Walking speed
  const latestSpeed = latest('walking_speed');
  const avgSpeed30  = avg(last30.map(w => safe(w.walking_speed)));
  const trendSpeed  = trend30('walking_speed');

  // Double support
  const latestDS = latest('walking_double_support_pct');
  const avgDS30  = avg(last30.map(w => safe(w.walking_double_support_pct)));

  // SpO2
  const latestSpo2 = latest('oxygen_saturation');
  const avgSpo2_30 = avg(last30.map(w => safe(w.oxygen_saturation)));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          Apple Health Vitals
          <span className="text-[10px] font-normal text-muted-foreground ml-1">iPhone + Apple Watch sensors</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-6" style={height ? { maxHeight: height, overflowY: 'auto' } : {}}>

          {/* Flights climbed */}
          {avgFlights30 != null && (
            <Tile
              icon={<MoveUp className="w-3 h-3" />}
              label="Floors climbed"
              latest={avgFlights30}
              unit="floors/day avg"
              avg30={null}
              spark={<Spark data={sparkData('flights_climbed', last90)} dataKey="floors" color="hsl(var(--foreground))" refLine={10} />}
              note="10+ floors/day is associated with lower cardiovascular risk"
            />
          )}

          {/* Respiratory rate */}
          {latestRespRate != null && (
            <Tile
              icon={<Wind className="w-3 h-3" />}
              label="Breathing rate"
              latest={latestRespRate}
              unit="breaths/min"
              avg30={avgRespRate30}
              trend={trendResp}
              trendGoodDir="down"
              spark={<Spark data={sparkData('respiratory_rate', last90)} dataKey="breaths/min" color="hsl(217 91% 60%)" />}
              note="Resting rate (overnight). Healthy: 12–18. Elevated can indicate fatigue or illness."
            />
          )}

          {/* Walking asymmetry */}
          {latestAsymm != null && (
            <Tile
              icon={<Footprints className="w-3 h-3" />}
              label="Gait asymmetry"
              latest={latestAsymm}
              unit="%"
              avg30={avgAsymm30}
              trend={trendAsymm}
              trendGoodDir="down"
              spark={<Spark data={sparkData('walking_asymmetry_pct', last90)} dataKey="%" color="hsl(38 92% 50%)" refLine={10} />}
              note="% difference between left/right step time. <10% is normal; higher may signal fatigue or injury."
            />
          )}

          {/* Walking speed */}
          {latestSpeed != null && (
            <Tile
              icon={<Footprints className="w-3 h-3" />}
              label="Walking speed"
              latest={latestSpeed}
              unit="km/h"
              avg30={avgSpeed30}
              trend={trendSpeed}
              trendGoodDir="up"
              spark={<Spark data={sparkData('walking_speed', last90)} dataKey="km/h" color="hsl(142 71% 45%)" />}
              note="Strong longevity predictor. >5 km/h is excellent; <3.6 km/h is a clinical risk marker."
            />
          )}

          {/* Double support */}
          {latestDS != null && (
            <Tile
              icon={<Footprints className="w-3 h-3" />}
              label="Double support"
              latest={latestDS}
              unit="%"
              avg30={avgDS30}
              spark={<Spark data={sparkData('walking_double_support_pct', last90)} dataKey="%" color="hsl(280 65% 60%)" />}
              note="% of stride with both feet on ground. Higher = more cautious gait; increases with fatigue/age."
            />
          )}

          {/* SpO2 */}
          {latestSpo2 != null && (
            <Tile
              icon={<Droplets className="w-3 h-3" />}
              label="Blood oxygen (SpO2)"
              latest={latestSpo2}
              unit="%"
              avg30={avgSpo2_30}
              spark={<Spark data={sparkData('oxygen_saturation', last90)} dataKey="SpO2 %" color="hsl(0 72% 51%)" refLine={95} />}
              note="Normal: 95–100%. Below 95% warrants medical attention."
            />
          )}

          {/* Mindful minutes */}
          {totalMindful30 > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Brain className="w-3 h-3" />Mindfulness
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold tabular-nums">{totalMindful30}</span>
                <span className="text-xs text-muted-foreground">min last 30d</span>
              </div>
              <Spark
                data={last90.map(w => ({ date: w.date, v: w.mindful_minutes }))}
                dataKey="min"
                color="hsl(280 65% 60%)"
              />
              <p className="text-[10px] text-muted-foreground/60">
                {Math.round(totalMindful30 / 30)} min/day avg · meditation &amp; breathing sessions
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
