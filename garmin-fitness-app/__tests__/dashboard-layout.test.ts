import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// The Health tab was split into Recovery / Body / Lifestyle and logging moved next to its results.
// A reorganisation must not lose a card: every one that existed must still be mounted, once.
const src = readFileSync(join(__dirname, '..', 'components', 'Dashboard.tsx'), 'utf8');
const page = readFileSync(join(__dirname, '..', 'app', 'page.tsx'), 'utf8');
const data = readFileSync(join(__dirname, '..', 'components', 'DataManager.tsx'), 'utf8');

function block(id: string): string {
  const start = src.indexOf(`{subTab === '${id}' && (`);
  expect(start, `tab ${id} exists`).toBeGreaterThan(-1);
  const next = src.indexOf('{subTab === ', start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

const EXPECTED: Record<string, string[]> = {
  home: ['MorningBrief', 'ReadinessScore', 'DailySuggestion', 'WeeklyVolumeChart', 'PersonalBests', 'WeeklyReport'],
  training: ['ExerciseProgress', 'ExerciseLogForm', 'TrainingLoadChart', 'OptimalTrainingDays', 'TrainingMonotony', 'TrainingHeatmap'],
  recovery: ['HRVReadinessCard', 'HeartRateChart', 'HRVTrainingLoadChart', 'FitnessTrendChart', 'SleepDebtChart', 'BodyBatteryChart', 'InjuryRiskScore'],
  body: ['BodyCompositionChart', 'WeightChart', 'LongevityScore', 'CardiovascularAge', 'AppleHealthVitals', 'AirofitProgress'],
  lifestyle: ['NutritionLog', 'NutritionSection', 'CaloriesChart', 'TravelLog', 'TravelSection', 'CorrelationExplorer'],
  cycling: ['FtpHistoryChart', 'FTPProgressionChart', 'WkgZonesChart', 'PowerChart', 'PowerCurveChart', 'PowerZonesChart', 'HRZoneDistribution', 'EfficiencyFactorChart', 'CadenceChart', 'TrainingPlanGenerator'],
};

describe('dashboard layout', () => {
  it('has no tab called health any more, and the three that replace it', () => {
    expect(src).not.toContain("subTab === 'health'");
    for (const id of ['recovery', 'body', 'lifestyle']) expect(src).toContain(`{ id: '${id}'`);
  });

  for (const [tab, comps] of Object.entries(EXPECTED)) {
    it(`${tab} mounts every card it should`, () => {
      const b = block(tab);
      for (const c of comps) expect(b, `${c} on ${tab}`).toMatch(new RegExp(`<${c}[\\s/>]`));
    });
  }

  it('every card is on exactly one tab', () => {
    const all = Object.entries(EXPECTED).filter(([t]) => t !== 'cycling').flatMap(([, c]) => c);
    for (const c of all) {
      const tabs = Object.keys(EXPECTED).filter(t => new RegExp(`<${c}[\\s/>]`).test(block(t)));
      expect(tabs.length, `${c} appears on ${tabs.join(', ')}`).toBe(1);
    }
  });

  it('logging lives beside its results, and Data keeps only import, sync and editing', () => {
    expect(block('lifestyle')).toContain('<NutritionLog');
    expect(block('lifestyle')).toContain('<TravelLog');
    expect(block('training')).toContain('<ExerciseLogForm');
    expect(data).not.toMatch(/<(NutritionLog|TravelLog|ExerciseLog)\b/);
    expect(data).toContain('<Upload');
  });

  it('Upload is no longer a top-level tab and Data is reachable before any data exists', () => {
    expect(page).not.toMatch(/id: 'upload'/);
    expect(page).toMatch(/id: 'data' as Tab, label: 'Data', icon: Database \}/);
  });

  it('the morning brief is on Home, not above every tab', () => {
    expect(page).not.toContain('<MorningBrief');
    expect(page).toContain('<QuickLog');
  });
});
