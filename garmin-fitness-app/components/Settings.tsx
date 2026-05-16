'use client';
import { useState } from 'react';
import { UserSettings, saveSettings, getAge, getMaxHR, getThresholdHR, getBMI } from '@/lib/settings';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Info } from 'lucide-react';

interface Props {
  settings: UserSettings;
  onSave: (s: UserSettings) => void;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-foreground">{label}</label>
        {hint && (
          <span className="group relative">
            <Info className="w-3 h-3 text-muted-foreground cursor-help" />
            <span className="absolute left-5 top-0 z-10 hidden group-hover:block w-52 text-[10px] bg-popover border border-border rounded px-2 py-1.5 text-muted-foreground shadow-md">
              {hint}
            </span>
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function NumericInput({ value, onChange, placeholder, min, max, step = 1 }: {
  value: number | null; onChange: (v: number | null) => void;
  placeholder?: string; min?: number; max?: number; step?: number;
}) {
  return (
    <input
      type="number"
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
      placeholder={placeholder}
      min={min} max={max} step={step}
      className="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
    />
  );
}

export default function Settings({ settings, onSave }: Props) {
  const [form, setForm] = useState<UserSettings>({ ...settings });
  const [saved, setSaved] = useState(false);

  function update<K extends keyof UserSettings>(key: K, val: UserSettings[K]) {
    setForm(prev => ({ ...prev, [key]: val }));
    setSaved(false);
  }

  function handleSave() {
    saveSettings(form);
    onSave(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  const age    = getAge(form);
  const maxHR  = getMaxHR(form);
  const thrHR  = getThresholdHR(form);
  const bmi    = getBMI(form);

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div>
        <h2 className="text-base font-semibold">Personal Settings</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Used to personalise benchmarks, training zones, and AI coaching analysis.
        </p>
      </div>

      {/* Demographics */}
      <Card>
        <CardHeader className="pb-2"><CardTitle>Demographics</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <Field label="Birth year" hint="Used to calculate your age bracket for peer benchmarks.">
            <NumericInput
              value={form.birthYear}
              onChange={v => update('birthYear', v ?? new Date().getFullYear() - 45)}
              min={1940} max={new Date().getFullYear() - 10}
            />
          </Field>
          <Field label="Sex" hint="Affects VO₂max norms and some heart rate benchmarks.">
            <select
              value={form.sex}
              onChange={e => update('sex', e.target.value as 'male' | 'female')}
              className="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </Field>
          <Field label="Weight (kg)" hint="Used to calculate W/kg power ratios for cycling.">
            <NumericInput value={form.weightKg} onChange={v => update('weightKg', v)} placeholder="e.g. 75" min={30} max={200} step={0.1} />
          </Field>
          <Field label="Height (cm)" hint="Used to calculate BMI.">
            <NumericInput value={form.heightCm} onChange={v => update('heightCm', v)} placeholder="e.g. 178" min={120} max={230} />
          </Field>
        </CardContent>
      </Card>

      {/* Heart rate zones */}
      <Card>
        <CardHeader className="pb-2"><CardTitle>Heart Rate Zones</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <Field label="Max HR (bpm)" hint="Leave blank to auto-calculate: 220 − age. Set manually if you know your true max from a recent test.">
            <NumericInput value={form.maxHR} onChange={v => update('maxHR', v)} placeholder={`Auto: ${maxHR} bpm`} min={120} max={220} />
          </Field>
          <Field label="Threshold HR (bpm)" hint="The heart rate you can sustain for ~1 hour (FTP/LT2). Leave blank to use 85% of max HR.">
            <NumericInput value={form.thresholdHR} onChange={v => update('thresholdHR', v)} placeholder={`Auto: ${thrHR} bpm`} min={100} max={210} />
          </Field>
        </CardContent>
      </Card>

      {/* Goals */}
      <Card>
        <CardHeader className="pb-2"><CardTitle>Daily Goals</CardTitle></CardHeader>
        <CardContent>
          <Field label="Daily steps goal" hint="Shown as the green target line on the steps chart.">
            <NumericInput value={form.dailyStepsGoal} onChange={v => update('dailyStepsGoal', v ?? 10000)} placeholder="10000" min={1000} max={30000} step={500} />
          </Field>
        </CardContent>
      </Card>

      {/* Computed summary */}
      <Card className="bg-secondary/40">
        <CardHeader className="pb-2"><CardTitle>Computed Values</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">Age</span><span className="font-mono font-medium">{age} yrs</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Max HR</span><span className="font-mono font-medium">{maxHR} bpm</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Threshold HR</span><span className="font-mono font-medium">{thrHR} bpm</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">BMI</span><span className="font-mono font-medium">{bmi ?? '—'}</span></div>
          <div className="flex justify-between col-span-2">
            <span className="text-muted-foreground">Zone 2 HR range</span>
            <span className="font-mono font-medium">{Math.round(maxHR * 0.60)}–{Math.round(maxHR * 0.70)} bpm</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} className="min-w-24">
          {saved ? <><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />Saved</> : 'Save settings'}
        </Button>
        {saved && <span className="text-xs text-green-400">Settings saved. Charts and AI coaching will use your updated profile.</span>}
      </div>
    </div>
  );
}
