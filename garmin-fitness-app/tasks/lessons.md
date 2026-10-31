# Lessons

Bug patterns and wrong assumptions found in this app. Read before building a
chart or a score — most of these have bitten more than once.

**Every entry here has a regression test.** If a bug is worth a lesson it is
worth a test, named after the property rather than the implementation, written
from the real failing numbers.

---

## 1. Step functions freeze a score

Scores built from bands sit at the band floor and never move. The Longevity
score read 84 for months while resting HR improved 54.8 → 52.9 and sleep 6.9h
→ 7.7h, because neither crossed a band edge. Cardiovascular age was worse: a
cliff at exactly 50 bpm meant 49.9 scored 100 and 50.0 scored 80 — a tenth of
a beat worth twenty points.

**Tell:** every sub-score is a round number.
**Fix:** interpolate between the same band edges (`lib/longevity.ts`
`interpolateScore`). Calibration unchanged at the anchors, continuous between.
**Tests:** `__tests__/longevity.test.ts` — "has no cliff at 50 bpm", "MOVES for
a real improvement inside one old band".

## 2. Period filter silently ignored

A component handed `allActivities` / `allWellness` that does no windowing of
its own will ignore the range selector entirely. Walking & Activity showed 703
walks under a 1Y selection.

**Fix:** pass the period-filtered set — UNLESS the component computes rolling
windows or forward-fills sparse readings (Cardiovascular Age, Training
Monotony). Those need the full history; trim the DISPLAY instead, and say so in
the caption.
**Watch for:** a cutoff landing mid-week in a weekly aggregation pads the
missing days with zeros and distorts that week.

## 3. Direction errors invert a whole card

Higher is better for HRV, sleep score, sleep hours, body battery. Lower is
better for resting HR and stress. One flipped flag silently inverts every
verdict a card draws.

**Never alias stress to HRV.** The Vivosmart 5 exports no RMSSD and its stress
score IS the HRV-derived metric — but it runs the opposite way, so substituting
it would invert every conclusion.
**Tests:** `__tests__/nutrition.test.ts` — "points every outcome in the right
direction" asserts each by name, not by rule.

## 4. Null is not zero

An unlogged day is not a zero. Treating gaps as zeros washed out the nutrition
analysis (every forgotten day became a sober, sugar-free one), and a Garmin
profile fallback once stamped the same weight onto every day in the database.

**Fix:** skip nulls explicitly; require an entered 0 to mean "none". Decide per
field, not per day.

## 5. Timezones and DST

`toISOString()` shifts an evening record to the next day in any zone ahead of
UTC — it split a day's training load across two days in the monotony
calculation. Static UTC offsets are wrong half the year: the home side resolved
DST from a zone name while the destination used a standard-time table, so
Copenhagen → Frankfurt read as one zone west when both are on CEST.

**Fix:** local-date formatting for day keys; IANA zone names resolved on the
specific date for anything timezone-related.
**Tests:** `__tests__/travel.test.ts` — same-zone trip in three seasons, the
southern hemisphere, and the weeks when Europe and the US are out of step.

## 6. Confounders presented as findings

Alcohol appeared to buy an extra hour of sleep, because it is drunk at
weekends — when lie-ins happen. The same nights scored worse on sleep QUALITY,
which was the giveaway.

**Fix:** stratify by day type and average the strata, so the weekday/weekend
mix cannot drive the result. Flag estimates that could only be made in one
stratum.
**Tests:** `__tests__/nutrition.test.ts` — "does not credit alcohol with the
weekend lie-in" builds data where the true effect is zero.

## 7. Never default to a metric the device does not record

Cards hardcoded to HRV reported "0 days have an HRV reading" next to a full
year of HRV, because the device reports stress instead.

**Fix:** `availableOutcomes()` — offer and default to metrics that have data.

## 8. Unit and definition drift between devices

Garmin's Index S2 reports Tanita-style muscle mass (fat-free mass minus bone,
~58kg); Scanfit reports skeletal muscle mass (~35kg). Same word, different
quantity, 40% apart.

**Fix:** tag the source on the row (`body_comp_source`) and break the line at
the changeover rather than plotting through it.

## 9. Don't score a choice as an outcome

"Next-day training load" was scored higher-is-better, so more training after
drinking rendered green — as if alcohol helped. It records a decision, not
something that happened to the body. Removed.

## 10. An impact chart needs a baseline

Plotting absolute values when no baseline exists looks meaningful but compares
to nothing. Say what is missing and what to do about it, with the real counts,
rather than a generic "not enough data".

## 11. The git repo root is one level ABOVE the app

`~/Developer/Claude` is the repository; `garmin-fitness-app/` is a subdirectory.
GitHub Actions only reads `.github/workflows/` at the **repository root**, so a
workflow placed in `garmin-fitness-app/.github/workflows/` never runs.

`pr-checks.yml` (typecheck + tests, on every push to main and every PR) lived
there and had therefore **never executed** — across 23 pushes. The safety net
appeared to exist and did not. Two shadow copies of the sync workflows lived
there too; one pointed at a stale script, which had previously caused a real
incident where per-second data never landed while the sync reported success.

**Rule:** workflows go in `/.github/workflows/`. Paths inside them are
repo-root-relative, so app-level steps need `working-directory:
garmin-fitness-app`. Never keep a second copy of a workflow — a duplicate that
silently does nothing is worse than no copy at all.

## 12. The gate is a script, not a promise

Correctness and security both run as one command — `npm run verify`
(scripts/verify.sh): TypeScript, tests, production build, dependency audit,
literal-secret scan, and a check that every `dangerouslySetInnerHTML` escapes
its input first. CI runs the SAME script on every push and PR, so a green local
run means something.

It was written after a full audit found an XSS sink, four auth checks that
failed open, a CSRF-able delete and a critical advisory — none of which the
existing checks would have caught, and all of which depended on someone
remembering to look.

**Waivers:** allowed, but they must name the package, give the reason, and
carry a review date, in the script itself. `next` and `postcss` are currently
waived — no fix exists inside Next 14, neither is reachable here (no
middleware, no next/image, no rewrites, no i18n, Vercel-hosted), and postcss
runs only at build time. Anything not explicitly waived still fails the build.
A permanently-red gate gets ignored, which is worse than no gate.

## 13. Test with the date shape the database actually returns

`windowedValue()` built a timestamp as `` `${date}T00:00:00` ``. That works for
a bare `YYYY-MM-DD`, which is what every test used — and produces
`…T00:00:00.000ZT00:00:00` → `Invalid Date` → `NaN` for the full ISO strings
the wellness route really returns.

Because `NaN < days` is false, **every reading counted as outside the window**.
The function fell back to a single value and the card read *"single reading,
NaNd old"*. The median fix shipped the day before had therefore never run on
real data — while the history series, which parsed dates differently, computed
proper medians, so the card and its own chart drifted apart again.

**Rule:** a date helper must accept both shapes, and at least one test must use
the shape the DB returns. `String(d).slice(0, 10)` before constructing. The
visible `NaN` was lucky; a silently-wrong window would have been worse.
