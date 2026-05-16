'use client';

import { useState, useEffect, useMemo } from 'react';
import Upload from '@/components/Upload';
import Dashboard from '@/components/Dashboard';
import AICoach from '@/components/AICoach';
import SettingsPanel from '@/components/Settings';
import InsightCards from '@/components/InsightCards';
import { Activity, WellnessRecord } from '@/types';
import { Activity as ActivityIcon, BarChart3, Sparkles, Upload as UploadIcon, Settings as SettingsIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { subDays, startOfYear, parseISO } from 'date-fns';
import { UserSettings, loadSettings, DEFAULT_SETTINGS } from '@/lib/settings';

type Tab = 'upload' | 'dashboard' | 'ai-coach' | 'settings';

const PERIODS = [
  { label: '1W',   days: 7 },
  { label: '1M',   days: 30 },
  { label: '3M',   days: 90 },
  { label: '6M',   days: 180 },
  { label: '1Y',   days: 365 },
  { label: 'YTD',  days: -1 },   // special: since Jan 1
  { label: 'All',  days: 99999 },
] as const;

type PeriodLabel = typeof PERIODS[number]['label'];

function cutoffForPeriod(label: PeriodLabel): Date {
  if (label === 'YTD') return startOfYear(new Date());
  if (label === 'All') return new Date(0);
  const p = PERIODS.find(p => p.label === label)!;
  return subDays(new Date(), p.days);
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('upload');
  const [allActivities, setAllActivities] = useState<Activity[]>([]);
  const [allWellness, setAllWellness] = useState<WellnessRecord[]>([]);
  const [hasData, setHasData] = useState(false);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodLabel>('1Y');
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    // Load settings: DB is source of truth, localStorage is the fast cache
    async function initSettings() {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const s: UserSettings = await res.json();
          setSettings(s);
          // Keep localStorage in sync so next paint is instant
          import('@/lib/settings').then(({ saveSettings }) => saveSettings(s));
          return;
        }
      } catch { /* network error — fall through to localStorage */ }
      setSettings(loadSettings());
    }
    initSettings();
    loadData();
  }, []);

  async function loadData() {
    try {
      const [actRes, wellRes] = await Promise.all([
        fetch('/api/activities'),
        fetch('/api/wellness'),
      ]);
      if (actRes.ok && wellRes.ok) {
        const acts: Activity[] = await actRes.json();
        const well: WellnessRecord[] = await wellRes.json();
        setAllActivities(acts);
        setAllWellness(well);
        if (acts.length > 0) { setHasData(true); setActiveTab('dashboard'); }
      }
    } catch { /* DB not yet provisioned */ }
    finally { setLoading(false); }
  }

  async function onUploadComplete() {
    await loadData();
    setActiveTab('dashboard');
  }

  // Filter in-memory — instant, no server round-trip
  const cutoff = useMemo(() => cutoffForPeriod(period), [period]);

  const activities = useMemo(
    () => allActivities.filter(a => parseISO(a.date) >= cutoff),
    [allActivities, cutoff]
  );

  const wellness = useMemo(
    () => allWellness.filter(w => new Date(w.date) >= cutoff),
    [allWellness, cutoff]
  );

  const tabs = [
    { id: 'upload' as Tab, label: 'Upload', icon: UploadIcon },
    { id: 'dashboard' as Tab, label: 'Dashboard', icon: BarChart3, disabled: !hasData },
    { id: 'ai-coach' as Tab, label: 'AI Coach', icon: Sparkles, disabled: !hasData },
    { id: 'settings' as Tab, label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border/60 bg-background/95 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded bg-foreground flex items-center justify-center">
              <ActivityIcon className="w-3 h-3 text-background" />
            </div>
            <span className="text-sm font-semibold tracking-tight">Fitness Analytics</span>
          </div>
          {hasData && (
            <span className="text-xs text-muted-foreground">
              {activities.length.toLocaleString()} of {allActivities.length.toLocaleString()} activities
            </span>
          )}
        </div>
      </header>

      {/* Tab nav + period selector */}
      <div className="border-b border-border/60 bg-background sticky top-12 z-10">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <nav className="flex gap-0 -mb-px">
            {tabs.map(({ id, label, icon: Icon, disabled }) => (
              <button
                key={id}
                onClick={() => !disabled && setActiveTab(id)}
                disabled={disabled}
                className={cn(
                  'flex items-center gap-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors',
                  activeTab === id
                    ? 'border-foreground text-foreground'
                    : disabled
                    ? 'border-transparent text-muted-foreground/30 cursor-not-allowed'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </nav>

          {/* Period selector — only shown on dashboard */}
          {activeTab === 'dashboard' && hasData && (
            <div className="flex items-center gap-0.5 py-2">
              {PERIODS.map(p => (
                <button
                  key={p.label}
                  onClick={() => setPeriod(p.label)}
                  className={cn(
                    'px-2.5 py-1 text-[11px] font-medium rounded transition-colors',
                    period === p.label
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-5 h-5 border border-border border-t-foreground rounded-full animate-spin" />
          </div>
        ) : activeTab === 'upload' ? (
          <Upload onUploadComplete={onUploadComplete} />
        ) : activeTab === 'dashboard' ? (
          <>
            {hasData && <InsightCards />}
            <Dashboard activities={activities} allActivities={allActivities} wellness={wellness} allWellness={allWellness} cutoff={cutoff} settings={settings} />
          </>
        ) : activeTab === 'ai-coach' ? (
          <AICoach activities={allActivities} wellness={allWellness} settings={settings} />
        ) : (
          <SettingsPanel settings={settings} onSave={s => setSettings({ ...s })} />
        )}
      </main>
    </div>
  );
}
