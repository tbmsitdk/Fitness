'use client';

import { useState, useEffect } from 'react';
import Upload from '@/components/Upload';
import Dashboard from '@/components/Dashboard';
import AICoach from '@/components/AICoach';
import { Activity, WellnessRecord } from '@/types';
import { Activity as ActivityIcon, BarChart3, Bot, Upload as UploadIcon } from 'lucide-react';
import { clsx } from 'clsx';

type Tab = 'upload' | 'dashboard' | 'ai-coach';

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('upload');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [wellness, setWellness] = useState<WellnessRecord[]>([]);
  const [hasData, setHasData] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
        setActivities(acts);
        setWellness(well);
        if (acts.length > 0) {
          setHasData(true);
          setActiveTab('dashboard');
        }
      }
    } catch {
      // DB not yet provisioned — stay on upload tab
    } finally {
      setLoading(false);
    }
  }

  async function onUploadComplete() {
    await loadData();
    setActiveTab('dashboard');
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode; disabled?: boolean }[] = [
    { id: 'upload', label: 'Upload', icon: <UploadIcon className="w-4 h-4" /> },
    { id: 'dashboard', label: 'Dashboard', icon: <BarChart3 className="w-4 h-4" />, disabled: !hasData },
    { id: 'ai-coach', label: 'AI Coach', icon: <Bot className="w-4 h-4" />, disabled: !hasData },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-garmin-blue rounded-lg flex items-center justify-center">
                <ActivityIcon className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900">Garmin Analytics</h1>
                <p className="text-xs text-slate-500 hidden sm:block">Personal fitness intelligence</p>
              </div>
            </div>
            {hasData && (
              <div className="text-xs text-slate-500">
                {activities.length} activities loaded
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Navigation tabs */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-1 -mb-px" aria-label="Tabs">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => !tab.disabled && setActiveTab(tab.id)}
                disabled={tab.disabled}
                className={clsx(
                  'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                  activeTab === tab.id
                    ? 'border-garmin-blue text-garmin-blue'
                    : tab.disabled
                    ? 'border-transparent text-slate-300 cursor-not-allowed'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-2 border-garmin-blue border-t-transparent rounded-full animate-spin" />
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
