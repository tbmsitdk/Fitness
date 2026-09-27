-- ═══════════════════════════════════════════════════════════════════════════
-- Convert historical Garmin muscle mass to skeletal muscle mass (Scanfit terms)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY
--   Garmin's Index S2 reports Tanita-style "muscle mass": fat-free mass minus
--   bone, which includes organs and all body water. Scanfit reports SKELETAL
--   muscle mass — only skeletal muscle. For the same body these differ by about
--   40%, so switching scales looked like sudden, dramatic muscle loss.
--
--   Measured on the same day: Garmin 57.9 kg, Scanfit 35.2 kg.
--   Ratio = 35.2 / 57.9 = 0.607945
--
-- CAVEAT — READ THIS
--   A single constant ratio is an APPROXIMATION and was requested as one. The
--   true relationship between the two measures varies with body water and fat
--   mass, so converted history is derived, not measured. That is why every row
--   this touches is tagged 'garmin_converted' rather than passing as a reading.
--
-- SAFETY
--   Idempotent: only rows with body_comp_source IS NULL are converted, and the
--   tag is written in the same statement. Running it twice is a no-op — it
--   cannot halve your data again.
--
-- HOW TO RUN
--   Vercel dashboard → Storage → your Postgres database → Query, then paste.
--   Run STEP 0 alone first and read the output before running anything else.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── STEP 0 — DRY RUN. Run this alone first; it changes nothing. ────────────
-- Check that "converted" looks physiologically sane (roughly 33-40 kg) and
-- that rows_to_convert matches how many Garmin readings you expect.
SELECT
  COUNT(*)                                         AS rows_to_convert,
  MIN(date)                                        AS earliest,
  MAX(date)                                        AS latest,
  ROUND(MIN(muscle_mass_kg), 1)                    AS current_min,
  ROUND(MAX(muscle_mass_kg), 1)                    AS current_max,
  ROUND(MIN(muscle_mass_kg) * 0.607945, 1)         AS converted_min,
  ROUND(MAX(muscle_mass_kg) * 0.607945, 1)         AS converted_max
FROM wellness
WHERE muscle_mass_kg IS NOT NULL
  AND body_comp_source IS NULL
  AND date < CURRENT_DATE;


-- ─── STEP 1 — Back up, so this is reversible. ───────────────────────────────
-- Keeps the original values. Do not skip: there is no other way back.
CREATE TABLE IF NOT EXISTS wellness_muscle_backup AS
SELECT date, muscle_mass_kg, NOW() AS backed_up_at
FROM wellness
WHERE muscle_mass_kg IS NOT NULL;


-- ─── STEP 2 — Convert historical rows. ──────────────────────────────────────
-- Only untagged rows before today. Rounds to 1 decimal, matching the scale's
-- own precision — more digits would imply accuracy the conversion doesn't have.
UPDATE wellness
SET muscle_mass_kg   = ROUND((muscle_mass_kg * 0.607945)::numeric, 1),
    body_comp_source = 'garmin_converted'
WHERE muscle_mass_kg IS NOT NULL
  AND body_comp_source IS NULL
  AND date < CURRENT_DATE;


-- ─── STEP 3 — Today's actual Scanfit reading. ───────────────────────────────
-- Inserts the row if today has no wellness record yet, otherwise updates it.
INSERT INTO wellness (date, muscle_mass_kg, body_comp_source)
VALUES (CURRENT_DATE, 35.2, 'scanfit')
ON CONFLICT (date) DO UPDATE
SET muscle_mass_kg   = 35.2,
    body_comp_source = 'scanfit';


-- ─── STEP 4 — Verify. ───────────────────────────────────────────────────────
-- Expect: a block of 'garmin_converted' rows in the low-to-mid 30s, and one
-- 'scanfit' row at 35.2. A jump between them means the ratio needs revisiting.
SELECT date, muscle_mass_kg, body_comp_source
FROM wellness
WHERE muscle_mass_kg IS NOT NULL
ORDER BY date DESC
LIMIT 15;


-- ─── ROLLBACK, if the numbers look wrong ────────────────────────────────────
-- UPDATE wellness w
-- SET muscle_mass_kg = b.muscle_mass_kg,
--     body_comp_source = NULL
-- FROM wellness_muscle_backup b
-- WHERE w.date = b.date;
