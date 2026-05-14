'use client';

import { useState, useEffect } from 'react';
import Upload from '@/components/Upload';
import Dashboard from '@/components/Dashboard';
import AICoach from '@/components/AICoach';
import { Activity, WellnessRecord } from '@/types';
import { Activity as ActivityIcon, BarChart3, Sparkles, Upload as UploadIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tab = 'upload' | 'dashboard' | 'ai-coach';

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('upload');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [wellness, setWellness] = useState<WellnessRecord[]>([]);
  const [hasData, setHasData] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [actRes, wellRes] = await Promise.all([
        fetch('/api/activities'),
        fetch('/api/wellness'),
      ]);
      if (actRes.ok && wellRes.ok) {
        const acts: Activity[] = await actRes.json();
        const well: WellnessRecord[] = await wellRes.json();
        setActivities(acts);
        setWellness(well);
        if (acts.length > 0) { setHasData(true); setActiveTab('dashboard'); }
      }
    } catch { /* DB not yet provisioned */ }
    finally { setLoading(false); }
  }

  async function onUploadComplete() {
    await loadData();
    setActiveTab('dashboard');
  }

  const tabs = [
    { id: 'upload' as Tab, label: 'Upload', icon: UploadIcon },
    { id: 'dashboard' as Tab, label: 'Dashboard', icon: BarChart3, disabled: !hasData },
    { id: 'ai-coach' as Tab, label: 'AI Coach', icon: Sparkles, disabled: !hasData },
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
            <span className="text-xs text-muted-foreground">{activities.length.toLocaleString()} activities</span>
          )}
        </div>
      </header>

      {/* Tab nav */}
      <div className="border-b border-border/60 bg-background">
        <div className="max-w-7xl mx-auto px-6">
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
          <Dashboard activities={activities} wellness={wellness} />
        ) : (
          <AICoach activities={activities} wellness={wellness} />
        )}
      </main>
    </div>
  );
}
