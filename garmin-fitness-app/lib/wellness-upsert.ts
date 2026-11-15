// The SQL for writing a batch of wellness rows. Pure (no database import) so it
// can be run against a real Postgres in tests: a mistake here breaks the daily
// Garmin sync, and a type check cannot see inside a SQL string.

import { FILL_TOLERANCE, deriveSteps } from '@/lib/step-sources';

export type WellnessRow = {
  date: string;
  steps: number | null;
  resting_hr: number | null;
  hrv_rmssd: number | null;
  sleep_hours: number | null;
  sleep_score: number | null;
  stress_score: number | null;
  body_battery: number | null;
  weight_kg: number | null;
  vo2max: number | null;
  fitness_age: number | null;
  body_fat_pct: number | null;
  muscle_mass_kg: number | null;
  bone_mass_kg: number | null;
  body_water_pct: number | null;
  visceral_fat: number | null;
  // Optional: importers do not set it, only manual entry and the conversion do.
  body_comp_source?: string | null;
  metabolic_age: number | null;
  // Apple Health mobility & gait
  flights_climbed: number | null;
  respiratory_rate: number | null;
  walking_asymmetry_pct: number | null;
  walking_speed: number | null;
  walking_double_support_pct: number | null;
  oxygen_saturation: number | null;
  mindful_minutes: number | null;
  // Energy burned that day (kcal). Optional: only the Garmin sync sends them.
  kcal_burned?: number | null;
  active_kcal?: number | null;
  resting_kcal?: number | null;
  /**
   * Where `steps` came from. Absent means Garmin (the sync and the Garmin
   * export). 'apple' marks the Apple Health import, whose figure is used only
   * on days Garmin has no count.
   */
  steps_source?: 'garmin' | 'apple' | null;
  /** Apple import only: phone steps in Garmin's gaps, and Garmin's total as the export saw it. */
  steps_fill?: number | null;
  steps_fill_ref?: number | null;
};

export const PARAMS_PER_ROW = 32;

const COLUMNS = [
  'date', 'steps', 'resting_hr', 'hrv_rmssd', 'sleep_hours', 'sleep_score', 'stress_score', 'body_battery',
  'weight_kg', 'vo2max', 'fitness_age', 'body_fat_pct', 'muscle_mass_kg', 'bone_mass_kg', 'body_water_pct',
  'visceral_fat', 'metabolic_age', 'flights_climbed', 'respiratory_rate', 'walking_asymmetry_pct',
  'walking_speed', 'walking_double_support_pct', 'oxygen_saturation', 'mindful_minutes',
  'kcal_burned', 'active_kcal', 'resting_kcal', 'kcal_synced_at',
  'steps_garmin', 'steps_apple', 'steps_fill', 'steps_fill_ref',
] as const;

const whole = (v: unknown, max = 100_000) =>
  (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < max ? Math.round(v) : null);

/**
 * `steps` is never written directly on a conflict: it is DERIVED from the three
 * per-source columns, so the result is the same whichever import runs first.
 *
 *   steps_garmin   Garmin's total          (Garmin sync, Garmin export)
 *   steps_apple    the export's figure     (Apple Health import)
 *   steps_fill     phone steps in Garmin's gaps, and steps_fill_ref the export's
 *                  Garmin total, used only if it agrees with steps_garmin
 *
 * Mirror of deriveSteps() in lib/step-sources.ts.
 */
function stepsAssignment(): string {
  const g = 'COALESCE(EXCLUDED.steps_garmin, wellness.steps_garmin)';
  const a = 'COALESCE(EXCLUDED.steps_apple, wellness.steps_apple)';
  const f = 'COALESCE(EXCLUDED.steps_fill, wellness.steps_fill)';
  const ref = 'COALESCE(EXCLUDED.steps_fill_ref, wellness.steps_fill_ref)';
  return `
           steps_garmin=${g},
           steps_apple=${a},
           steps_fill=${f},
           steps_fill_ref=${ref},
           steps=CASE
             WHEN COALESCE(wellness.locked_fields,'[]')::jsonb ? 'steps' THEN wellness.steps
             WHEN ${g} IS NOT NULL THEN ${g} + CASE
               WHEN ${f} IS NOT NULL AND ${ref} IS NOT NULL AND ABS(${g} - ${ref}) <= ${FILL_TOLERANCE} * ${g}
               THEN ${f} ELSE 0 END
             WHEN ${a} IS NOT NULL THEN ${a}
             ELSE wellness.steps END`;
}

export function buildWellnessUpsert(batch: WellnessRow[]): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const rows: string[] = [];

  // ── Body composition is entered manually, never imported ────────────────
  // The Garmin scale is shared with another person, and the sync script
  // falls back to the static profile weight when a day has no reading —
  // which stamped the same weight onto every day. These columns are now
  // owned entirely by manual entry (Data → Wellness) and imports pass NULL,
  // so COALESCE in the upsert below preserves whatever you entered.
  // To re-enable Garmin import, pass r.<field> in values.push() again —
  // and re-add a guard dropping 0.00 readings, which is what a Garmin scale
  // writes when the impedance measurement fails.
  batch.forEach((r, j) => {
    const b = j * PARAMS_PER_ROW;
    rows.push(`(${Array.from({ length: PARAMS_PER_ROW }, (_, k) => `$${b + k + 1}`).join(',')})`);
    // Whole, plausible numbers only: this route is also reachable from the browser upload.
    const kcal = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 20000 ? Math.round(v) : null);
    const burned = kcal(r.kcal_burned);

    // Steps: a row from the Apple import writes the export's columns; anything else is Garmin's.
    const fromApple = r.steps_source === 'apple';
    const steps = whole(r.steps);
    const garmin = fromApple ? null : steps;
    const apple = fromApple ? steps : null;
    const fill = fromApple ? whole(r.steps_fill) : null;
    const fillRef = fromApple ? whole(r.steps_fill_ref) : null;

    values.push(
      r.date, deriveSteps({ garmin, apple, fill, fillRef }), r.resting_hr, r.hrv_rmssd, r.sleep_hours, r.sleep_score,
      // Body composition is USER-OWNED — never imported. See MANUAL_ONLY note above.
      r.stress_score, r.body_battery, null, r.vo2max ?? null, r.fitness_age ?? null,
      null, null, null,
      null, null, null,
      r.flights_climbed ?? null, r.respiratory_rate ?? null, r.walking_asymmetry_pct ?? null,
      r.walking_speed ?? null, r.walking_double_support_pct ?? null,
      r.oxygen_saturation ?? null, r.mindful_minutes ?? null,
      burned, kcal(r.active_kcal), kcal(r.resting_kcal),
      // Stamped only when a burn figure arrives, so an import without one
      // cannot make an old partial figure look freshly synced.
      burned != null ? new Date().toISOString() : null,
      garmin, apple, fill, fillRef,
    );
  });

  // locked() macro: if field is in the locked_fields JSON array, keep the existing DB value;
  // otherwise COALESCE (prefer incoming, fall back to existing).
  const locked = (col: string) =>
    `CASE WHEN COALESCE(wellness.locked_fields,'[]')::jsonb ? '${col}' THEN wellness.${col} ELSE COALESCE(EXCLUDED.${col},wellness.${col}) END`;

  const text = `INSERT INTO wellness (${COLUMNS.join(',')})
         VALUES ${rows.join(',')}
         ON CONFLICT (date) DO UPDATE SET${stepsAssignment()},
           resting_hr=${locked('resting_hr')},
           hrv_rmssd=${locked('hrv_rmssd')},
           sleep_hours=${locked('sleep_hours')},
           sleep_score=${locked('sleep_score')},
           stress_score=${locked('stress_score')},
           body_battery=${locked('body_battery')},
           weight_kg=${locked('weight_kg')},
           vo2max=${locked('vo2max')},
           fitness_age=${locked('fitness_age')},
           body_fat_pct=${locked('body_fat_pct')},
           muscle_mass_kg=${locked('muscle_mass_kg')},
           bone_mass_kg=${locked('bone_mass_kg')},
           body_water_pct=${locked('body_water_pct')},
           visceral_fat=${locked('visceral_fat')},
           metabolic_age=${locked('metabolic_age')},
           flights_climbed=${locked('flights_climbed')},
           respiratory_rate=${locked('respiratory_rate')},
           walking_asymmetry_pct=${locked('walking_asymmetry_pct')},
           walking_speed=${locked('walking_speed')},
           walking_double_support_pct=${locked('walking_double_support_pct')},
           oxygen_saturation=${locked('oxygen_saturation')},
           mindful_minutes=${locked('mindful_minutes')},
           kcal_burned=COALESCE(EXCLUDED.kcal_burned,wellness.kcal_burned),
           active_kcal=CASE WHEN EXCLUDED.kcal_burned IS NOT NULL THEN EXCLUDED.active_kcal ELSE wellness.active_kcal END,
           resting_kcal=CASE WHEN EXCLUDED.kcal_burned IS NOT NULL THEN EXCLUDED.resting_kcal ELSE wellness.resting_kcal END,
           kcal_synced_at=COALESCE(EXCLUDED.kcal_synced_at,wellness.kcal_synced_at),
           locked_fields=COALESCE(wellness.locked_fields,'[]')`;
  return { text, values };
}
