'use client';
import { useEffect, useState } from 'react';
import { useDataVersion } from '@/lib/data-refresh';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { WeeklyReport } from '@/types';

function RecoveryBadge({ status }: { status: WeeklyReport['recovery_status'] }) {
  const map = {
    good:     { label: 'Recovery: Good',     className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    moderate: { label: 'Recovery: Moderate', className: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    poor:     { label: 'Recovery: Poor',     className: 'bg-red-500/20 text-red-400 border-red-500/30' },
  };
  const { label, className } = map[status];
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${className}`}>
      {label}
    </span>
  );
}

function Skeleton() {
  return (
    <Card>
      <CardContent className="pt-4 space-y-3 animate-pulse">
        <div className="h-6 bg-muted rounded w-3/4" />
        <div className="h-4 bg-muted rounded w-1/2" />
        <div className="h-4 bg-muted rounded w-full" />
        <div className="h-4 bg-muted rounded w-5/6" />
      </CardContent>
    </Card>
  );
}

export default function WeeklyReportCard() {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dataVersion = useDataVersion();

  async function fetchReport(force = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/weekly-report?t=${Date.now()}${force ? '&force=1' : ''}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { report: WeeklyReport; error?: string };
      if (data.error) throw new Error(data.error);
      setReport(data.report);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  // Re-reads the (server-cached) report after any data change.
  useEffect(() => { fetchReport(); }, [dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Skeleton />;

  if (error) {
    return (
      <Card>
        <CardContent className="pt-4 flex items-center justify-between">
          <p className="text-xs text-red-400">Could not load weekly report: {error}</p>
          <Button variant="ghost" size="sm" onClick={() => fetchReport()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  if (!report) return null;

  return (
    <Card className="border-border bg-card">
      <CardContent className="pt-4 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <RecoveryBadge status={report.recovery_status} />
            <span className="text-[10px] text-muted-foreground">
              Week of {report.week_start}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-[10px] h-7 px-2 text-muted-foreground"
            onClick={() => fetchReport(true)}
          >
            Regenerate
          </Button>
        </div>

        {/* Headline */}
        <p className="text-base font-semibold leading-snug">{report.headline}</p>

        {/* Volume summary */}
        <p className="text-xs text-muted-foreground font-mono">{report.volume_summary}</p>

        {/* Key insight + recommendation */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
            <p className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">Key Insight</p>
            <p className="text-xs leading-relaxed">{report.key_insight}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
            <p className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">This Week</p>
            <p className="text-xs leading-relaxed">{report.recommendation}</p>
          </div>
        </div>

        <p className="text-[9px] text-muted-foreground/40 text-right">
          Generated {new Date(report.generated_at).toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}
