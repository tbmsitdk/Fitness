import { describe, it, expect } from 'vitest';
import { computeCardioAge, computeCardioAgeHistory, rhrScore, bodyFatScore, hrvScore, activeMinutesScore } from '@/lib/cardio-age';
import type { WellnessRecord, Activity } from '@/types';
import type { UserSettings } from '@/lib/settings';
import { DEFAULT_SETTINGS, getAgeAsOf } from '@/lib/settings';

describe('rhrScore', () => {
  it('scores lower RHR higher', () => {
    // Anchor values are unchanged; the scale between them is now continuous,
    // so a mid-band value no longer collapses to the band floor.
    expect(rhrScore(45)).toBe(100);
    expect(rhrScore(55)).toBe(85);
    expect(rhrScore(85)).toBe(10);
    expect(rhrScore(52)).toBeGreaterThan(rhrScore(58));
  });
});

describe('bodyFatScore', () => {
  it('rates a lean 57-year-old male as excellent', () => {
    expect(bodyFatScore(10, 57, 'male')).toBe(100); // age 40-59 band: excellent <= 11%
  });
  it('rates a higher body fat % lower for the same age/sex', () => {
    expect(bodyFatScore(32, 57, 'male')).toBeLessThan(bodyFatScore(20, 57, 'male'));
  });
});

describe('hrvScore', () => {
  it('scores above-expected HRV higher than 50', () => {
    expect(hrvScore(60, 57)).toBeGreaterThan(50); // expected ~48.5 at age 57
  });
  it('scores below-expected HRV lower than 50', () => {
    expect(hrvScore(20, 57)).toBeLessThan(50);
  });
  it('never exceeds the 0-100 range', () => {
    expect(hrvScore(500, 20)).toBeLessThanOrEqual(100);
    expect(hrvScore(0, 20)).toBeGreaterThanOrEqual(0);
  });
});

describe('activeMinutesScore', () => {
  it('rewards higher weekly volume', () => {
    expect(activeMinutesScore(350)).toBe(100);
    expect(activeMinutesScore(150)).toBe(70);   // anchor unchanged
    expect(activeMinutesScore(60)).toBe(40);    // anchor unchanged
    // Between anchors the score now rises rather than sitting at the floor.
    expect(activeMinutesScore(200)).toBeGreaterThan(70);
    expect(activeMinutesScore(200)).toBeLessThan(100);
  });
});

describe('computeCardioAge', () => {
  it('includes only factors with available data', () => {
    const result = computeCardioAge({ age: 57, sex: 'male', weeklyActiveMinutes: 200 });
    // activity is always present; nothing else was supplied
    expect(result.factors.map(f => f.key)).toEqual(['activity']);
  });

  it('includes all 6 factors when all data is present', () => {
    const result = computeCardioAge({
      age: 57, sex: 'male',
      restingHr: 50, vo2max: 45, bodyFatPct: 15, hrvRmssd: 55,
      weeklyActiveMinutes: 250, sleepScore14dAvg: 80,
    });
    expect(result.factors).toHaveLength(6);
    expect(result.factors.map(f => f.key).sort()).toEqual(
      ['activity', 'bodyfat', 'hrv', 'rhr', 'sleep', 'vo2'].sort()
    );
  });

  it('produces a younger cardio age for strong biomarkers', () => {
    const strong = computeCardioAge({
      age: 57, sex: 'male',
      restingHr: 45, vo2max: 48, bodyFatPct: 10, hrvRmssd: 65,
      weeklyActiveMinutes: 400, sleepScore14dAvg: 90,
    });
    expect(strong.cardioAge).toBeLessThan(57);
  });

  it('produces an older cardio age for weak biomarkers', () => {
    const weak = computeCardioAge({
      age: 57, sex: 'male',
      restingHr: 85, vo2max: 25, bodyFatPct: 35, hrvRmssd: 15,
      weeklyActiveMinutes: 20, sleepScore14dAvg: 40,
    });
    expect(weak.cardioAge).toBeGreaterThan(57);
  });

  it('renormalizes weights so missing data does not silently default to neutral', () => {
    // Only VO2max supplied (weight 25) — composite should equal that factor's own score
    const result = computeCardioAge({ age: 57, sex: 'male', vo2max: 46, weeklyActiveMinutes: 0 });
    // activity always included too (weight 15) — verify composite is the weighted
    // blend of exactly those two, not diluted by phantom missing factors
    const activityFactor = result.factors.find(f => f.key === 'activity')!;
    const vo2Factor = result.factors.find(f => f.key === 'vo2')!;
    const expected = Math.round((vo2Factor.score * 25 + activityFactor.score * 15) / 40);
    expect(result.composite).toBe(expected);
  });
});

// ── computeCardioAgeHistory ──────────────────────────────────────────────────

function wellnessDay(dateStr: string, overrides: Partial<WellnessRecord> = {}): WellnessRecord {
  return {
    id: 0, date: dateStr,
    steps: null, resting_hr: null, hrv_rmssd: null, sleep_hours: null, sleep_score: null,
    body_fat_pct: null, muscle_mass_kg: null, bone_mass_kg: null, body_water_pct: null,
    visceral_fat: null, metabolic_age: null, stress_score: null, body_battery: null,
    weight_kg: null, vo2max: null, fitness_age: null, flights_climbed: null,
    respiratory_rate: null, walking_asymmetry_pct: null, walking_speed: null,
    walking_double_support_pct: null, oxygen_saturation: null, mindful_minutes: null,
    ...overrides,
  };
}

function activityDay(dateStr: string, durationSeconds = 3600): Activity {
  return {
    id: 0, garmin_id: dateStr, activity_type: 'cycling', date: dateStr, title: '',
    distance_km: 20, duration_seconds: durationSeconds, calories: 500,
    avg_hr: 130, max_hr: 160, training_effect: null, avg_cadence: null,
    avg_speed_kmh: null, tss: null, avg_power: null, max_power: null,
    elevation_gain: null, normalized_power: null, ftp: null,
  };
}

const settings: UserSettings = { ...DEFAULT_SETTINGS, sex: 'male', birthDate: '1969-01-01' };

describe('computeCardioAgeHistory', () => {
  it('returns an empty array with no data at all', () => {
    expect(computeCardioAgeHistory([], [], settings)).toEqual([]);
  });

  it('produces no points when only activity data exists (no biomarkers)', () => {
    const activities = [activityDay('2024-01-05'), activityDay('2024-01-12')];
    expect(computeCardioAgeHistory([], activities, settings)).toEqual([]);
  });

  it('produces points once biomarker data exists, forward-filling between readings', () => {
    const wellness = [
      wellnessDay('2024-01-01', { resting_hr: 50, vo2max: 45 }),
      wellnessDay('2024-02-01', { resting_hr: 48, vo2max: 46 }),
    ];
    const history = computeCardioAgeHistory(wellness, [], settings);
    expect(history.length).toBeGreaterThan(0);
    // every point should carry a chronoAge and cardioAge
    for (const p of history) {
      expect(p.chronoAge).toBeGreaterThan(0);
      expect(p.cardioAge).toBeGreaterThan(0);
    }
  });

  it('drops a forward-filled reading once it exceeds its lookback window', () => {
    // A single VO2max reading, then sample far enough past it (>120d lookback) that
    // it should no longer count — history should stop extending biomarker coverage
    // indefinitely from one stale reading.
    const wellness = [wellnessDay('2024-01-01', { vo2max: 45 })];
    const history = computeCardioAgeHistory(wellness, [], settings, 30);
    const early = history.find(p => p.date === '2024-01-01');
    const late = history.find(p => new Date(p.date).getTime() - new Date('2024-01-01').getTime() > 130 * 86400000);
    expect(early).toBeDefined();
    expect(late).toBeUndefined(); // no longer generated once the only biomarker goes stale
  });

  it('reconstructs age-at-the-time using birthDate rather than todays age for every point', () => {
    const wellness = [
      wellnessDay('2020-01-01', { resting_hr: 50 }),
      wellnessDay('2020-06-01', { resting_hr: 50 }),
    ];
    const history = computeCardioAgeHistory(wellness, [], settings, 60);
    // birthDate 1969-01-01 => age 51 on 2020-01-01, age increases as dates progress
    const first = history[0];
    const last = history[history.length - 1];
    expect(first.chronoAge).toBe(51);
    expect(last.chronoAge).toBeGreaterThanOrEqual(first.chronoAge);
  });
});

// ── Regression: the card and its own chart must agree ──────────────────────
// BUG: the headline read 48 while the last point of the chart beside it read
// 49, because the two derived their inputs differently — median over a window
// vs forward-filling the latest reading, with different lookbacks — and the
// weekly sampling left the final point up to six days stale.
describe('headline and history agree', () => {
  const p = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86400000));

  const settings = {
    birthYear: 1969, birthDate: '1969-03-01', sex: 'male' as const, heightCm: 180,
    maxHR: null, thresholdHR: null, garminFtp: null, dailyStepsGoal: 10000,
    minCyclingPower: null, homeTimezone: 'Europe/Copenhagen',
  };

  // 120 days of steady readings with one freak resting-HR spike.
  const wellness = Array.from({ length: 120 }, (_, i) => ({
    id: i, date: daysAgo(119 - i),
    steps: null, resting_hr: i === 115 ? 64 : 50, hrv_rmssd: null,
    sleep_hours: 7.4, sleep_score: 70, stress_score: null, body_battery: null,
    weight_kg: null, vo2max: 42, fitness_age: null, body_fat_pct: 22.2,
    muscle_mass_kg: 34.5, bone_mass_kg: null, body_water_pct: null,
    visceral_fat: null, metabolic_age: null, locked_fields: null,
  })) as never[];

  const activities = Array.from({ length: 120 }, (_, i) => ({
    id: i, garmin_id: `a${i}`, activity_type: 'walking', date: daysAgo(i),
    title: 'Walk', distance_km: 5, duration_seconds: 2400, calories: 200,
    avg_hr: 100, max_hr: 120, training_effect: null, avg_cadence: null,
    avg_speed_kmh: null, tss: null, avg_power: null, max_power: null,
    elevation_gain: null,
  })) as never[];

  it('ends the history on the same cardio age the card shows', () => {
    const history = computeCardioAgeHistory(wellness, activities, settings);
    expect(history.length).toBeGreaterThan(2);

    // Derived exactly as the card derives them: medians over the same windows,
    // and the same 28-day activity window.
    const headline = computeCardioAge({
      age: getAgeAsOf(settings, new Date()),
      sex: 'male',
      restingHr: 50, vo2max: 42, bodyFatPct: 22.2, hrvRmssd: null,
      weeklyActiveMinutes: (28 * 2400) / 60 / 4,
      sleepScore14dAvg: 70,
    });

    expect(history[history.length - 1].cardioAge).toBe(headline.cardioAge);
  });

  it('ends on today, not on a stale weekly bucket', () => {
    const history = computeCardioAgeHistory(wellness, activities, settings);
    const lastDate = new Date(history[history.length - 1].date);
    const ageDays = (Date.now() - lastDate.getTime()) / 86400000;
    expect(ageDays).toBeLessThan(1.5);
  });

  it('is not moved by a single freak reading', () => {
    // The 64 bpm spike must not show up as a bump in the reconstructed series.
    const history = computeCardioAgeHistory(wellness, activities, settings);
    const recent = history.slice(-8).map(h => h.cardioAge);
    expect(new Set(recent).size).toBe(1);
  });
});
