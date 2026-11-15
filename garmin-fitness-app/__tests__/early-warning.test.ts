import { describe, it, expect } from 'vitest';
import { computeEarlyWarning } from '@/lib/early-warning';
import { buildBriefPrompt, parseBrief, BRIEF_SCHEMA } from '@/lib/daily-brief';
import type { WellnessRecord } from '@/types';
import type { TravelLog } from '@/lib/travel';

const TODAY = '2026-11-15';

const day = (offset: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};

const row = (date: string, over: Partial<WellnessRecord> = {}): WellnessRecord => ({
  id: 1, date, steps: null, resting_hr: null, hrv_rmssd: null, sleep_hours: null, sleep_score: null,
  body_fat_pct: null, muscle_mass_kg: null, bone_mass_kg: null, body_water_pct: null, visceral_fat: null,
  metabolic_age: null, stress_score: null, body_battery: null, weight_kg: null, vo2max: null,
  fitness_age: null, flights_climbed: null, respiratory_rate: null, walking_asymmetry_pct: null,
  walking_speed: null, walking_double_support_pct: null, oxygen_saturation: null, mindful_minutes: null,
  ...over,
});

/** 40 ordinary days (small realistic wobble), then `recent` overrides for the last days (index 0 = today). */
function history(recent: Partial<WellnessRecord>[] = [], shape: 'bare' | 'iso' = 'iso'): WellnessRecord[] {
  const rows: WellnessRecord[] = [];
  for (let i = 40; i >= 0; i--) {
    const wobble = (i % 5) - 2; // -2..2
    const base = { resting_hr: 50 + wobble * 0.5, stress_score: 28 + wobble, body_battery: 70 - wobble * 2, sleep_score: 75 + wobble };
    const date = shape === 'iso' ? `${day(i)}T00:00:00.000Z` : day(i);
    rows.push(row(date, { ...base, ...(recent[i] ?? {}) }));
  }
  return rows;
}

const sick = { resting_hr: 57, stress_score: 45, body_battery: 35, sleep_score: 55 };

describe('computeEarlyWarning', () => {
  it('stays quiet on an ordinary stretch', () => {
    const w = computeEarlyWarning({ wellness: history(), today: TODAY });
    expect(w.level).toBe('none');
    expect(w.signals).toEqual([]);
    expect(w.stale).toBe(false);
    expect(w.asOf).toBe(TODAY);
  });

  it('raises a warning when heart rate, stress and body battery all go wrong for days', () => {
    const w = computeEarlyWarning({ wellness: history([sick, sick, sick]), today: TODAY });
    expect(w.level).toBe('warning');
    expect(w.signals.map(s => s.key)).toEqual(expect.arrayContaining(['resting_hr', 'stress_score', 'body_battery']));
    expect(w.explanations).toEqual([]);
  });

  // Lesson 3: one flipped direction silently inverts the whole check.
  it('points every signal in the right direction — an excellent few days is not a warning', () => {
    const great = { resting_hr: 44, stress_score: 12, body_battery: 95, sleep_score: 95 };
    const w = computeEarlyWarning({ wellness: history([great, great, great]), today: TODAY });
    expect(w.level).toBe('none');
    expect(w.signals).toEqual([]);
  });

  it('reports deviation as positive in the BAD direction for both kinds of metric', () => {
    const w = computeEarlyWarning({ wellness: history([sick, sick, sick]), today: TODAY });
    for (const s of w.signals) expect(s.deviation, s.key).toBeGreaterThan(0);
    expect(w.signals.find(s => s.key === 'resting_hr')!.latest).toBe(57);
    expect(w.signals.find(s => s.key === 'body_battery')!.latest).toBe(35);
  });

  it('does not react to a single bad day', () => {
    const w = computeEarlyWarning({ wellness: history([sick]), today: TODAY });
    expect(w.level).toBe('none');
  });

  it('treats one drifting signal as not a pattern', () => {
    const w = computeEarlyWarning({ wellness: history([{ resting_hr: 57 }, { resting_hr: 57 }, { resting_hr: 57 }]), today: TODAY });
    expect(w.level).toBe('none');
    expect(w.signals).toHaveLength(1);
    expect(w.reason).toMatch(/one signal alone/);
  });

  it('does not call short nights an illness: sleep and body battery alone raise nothing', () => {
    const tired = { body_battery: 35, sleep_score: 55 };
    const w = computeEarlyWarning({ wellness: history([tired, tired, tired]), today: TODAY });
    expect(w.level).toBe('none');
    expect(w.reason).toMatch(/short nights/);
  });

  it('clears once the latest reading is back to normal', () => {
    const w = computeEarlyWarning({ wellness: history([{}, sick, sick]), today: TODAY });
    expect(w.level).toBe('none');
  });

  // Lesson 4: a gap is not a normal reading and not a zero.
  it('does not judge a metric with too few recent readings', () => {
    const gap = { resting_hr: null, stress_score: null, body_battery: null, sleep_score: null };
    const w = computeEarlyWarning({ wellness: history([sick, gap, gap]), today: TODAY });
    expect(w.level).toBe('none');
    expect(w.reason).toMatch(/Not enough/);
  });

  it('never treats a missing value as a zero reading', () => {
    // If null were read as 0, body battery "0" would be a huge deviation.
    const w = computeEarlyWarning({ wellness: history([{ body_battery: null }, { body_battery: null }, { body_battery: null }]), today: TODAY });
    expect(w.signals.find(s => s.key === 'body_battery')).toBeUndefined();
  });

  it('says so when the data is too old to judge today', () => {
    const old = history([sick, sick, sick]).filter(r => r.date.slice(0, 10) <= day(5));
    const w = computeEarlyWarning({ wellness: old, today: TODAY });
    expect(w.stale).toBe(true);
    expect(w.level).toBe('none');
    expect(w.asOf).toBe(day(5));
  });

  it('ignores rows dated after today', () => {
    const rows = [...history(), row(`${'2026-11-20'}T00:00:00.000Z`, sick)];
    expect(computeEarlyWarning({ wellness: rows, today: TODAY }).asOf).toBe(TODAY);
  });

  // Lesson 13: both date shapes.
  it('gives the same answer for bare dates and ISO timestamps', () => {
    const a = computeEarlyWarning({ wellness: history([sick, sick, sick], 'iso'), today: TODAY });
    const b = computeEarlyWarning({ wellness: history([sick, sick, sick], 'bare'), today: TODAY });
    expect(a).toEqual(b);
  });

  it('handles a perfectly flat baseline without dividing by zero', () => {
    const rows: WellnessRecord[] = [];
    for (let i = 40; i >= 0; i--) rows.push(row(day(i), { resting_hr: i < 3 ? 58 : 50, stress_score: i < 3 ? 50 : 30 }));
    const w = computeEarlyWarning({ wellness: rows, today: TODAY });
    expect(w.level).toBe('watch');
    for (const s of w.signals) expect(Number.isFinite(s.deviation)).toBe(true);
  });

  it('handles no data at all', () => {
    const w = computeEarlyWarning({ wellness: [], today: TODAY });
    expect(w).toMatchObject({ level: 'none', asOf: null, stale: true });
  });

  // Lesson 6: confounders are named, not hidden.
  describe('likely explanations', () => {
    const wellness = history([sick, sick, sick]);

    it('names alcohol logged on the nights before the readings', () => {
      const w = computeEarlyWarning({
        wellness, today: TODAY,
        nutritionLogs: [
          { date: day(1), alcohol_units: 4, candy_portions: null, savoury_snacks: null, sugary_drinks: null, last_food_time: null, caffeine_after_14: null, notes: null },
          { date: day(2), alcohol_units: 3, candy_portions: null, savoury_snacks: null, sugary_drinks: null, last_food_time: null, caffeine_after_14: null, notes: null },
          // Too long ago to matter, and an explicit zero: neither counts.
          { date: day(10), alcohol_units: 6, candy_portions: null, savoury_snacks: null, sugary_drinks: null, last_food_time: null, caffeine_after_14: null, notes: null },
          { date: day(3), alcohol_units: 0, candy_portions: null, savoury_snacks: null, sugary_drinks: null, last_food_time: null, caffeine_after_14: null, notes: null },
        ],
      });
      expect(w.level).toBe('warning'); // still reported, with its cause
      expect(w.explanations.join(' ')).toMatch(/Alcohol: 7 units logged over 2/);
    });

    it('names a trip that is under way', () => {
      const trip: TravelLog = {
        destination: 'Singapore', depart_date: day(4), arrive_date: day(4), return_date: null,
        home_utc_offset: 1, dest_utc_offset: 8, home_timezone: 'Europe/Copenhagen', dest_timezone: 'Asia/Singapore',
        stops: null, travel_mode: 'flight', purpose: 'work', notes: null,
      };
      const w = computeEarlyWarning({ wellness, today: TODAY, travelLogs: [trip] });
      expect(w.explanations.join(' ')).toMatch(/Travel: away in Singapore/);
    });

    it('names an unusually heavy training block', () => {
      const load = new Map<string, number>();
      for (let i = 40; i >= 0; i--) load.set(day(i), i <= 3 ? 150 : 40);
      const w = computeEarlyWarning({ wellness, today: TODAY, dailyLoad: load });
      expect(w.explanations.join(' ')).toMatch(/Training:/);
    });

    it('offers no explanation when nothing is wrong', () => {
      const load = new Map<string, number>([[day(1), 300]]);
      expect(computeEarlyWarning({ wellness: history(), today: TODAY, dailyLoad: load }).explanations).toEqual([]);
    });
  });
});

describe('daily brief', () => {
  const warning = computeEarlyWarning({ wellness: history([sick, sick, sick]), today: TODAY });

  it('puts the computed warning in the prompt, and tells the model it is authoritative', () => {
    const p = buildBriefPrompt({ today: TODAY, weekday: 'Sunday', warning, recentData: '## Raw daily data', readiness: { overall: 41, band: 'Maintain' } });
    expect(p).toContain('"level": "warning"');
    expect(p).toContain('41/100 (Maintain)');
    expect(p).toContain('Sunday 2026-11-15');
  });

  it('parses a brief and allows an empty watch field', () => {
    const b = parseBrief(JSON.stringify({ headline: ' Solid night. ', recovery: 'RHR 50.', today: 'Ride easy.', watch: '' }));
    expect(b).toEqual({ headline: 'Solid night.', recovery: 'RHR 50.', today: 'Ride easy.', watch: '' });
  });

  it('throws rather than store an empty or non-JSON brief', () => {
    expect(() => parseBrief('Good morning!')).toThrow(/not JSON/);
    expect(() => parseBrief('{"headline":"x","today":""}')).toThrow(/missing/);
  });

  it('has a closed schema with every property required', () => {
    expect(BRIEF_SCHEMA.additionalProperties).toBe(false);
    expect([...BRIEF_SCHEMA.required].sort()).toEqual(Object.keys(BRIEF_SCHEMA.properties).sort());
  });
});
