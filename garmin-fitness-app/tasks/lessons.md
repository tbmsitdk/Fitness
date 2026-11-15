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

## 14. One table, one read path

The AI coach told the user their Singapore → Copenhagen flight was "4.5 zones
westward". The dashboard said 7. The coach was reading a different query: the
chat and summary routes each had their own hand-written `SELECT` for
`travel_logs`, and both still listed the pre-multi-stop column set — no
`stops`, no `home_timezone`, no `dest_timezone`. So the coach saw a Delhi-only
trip and computed the leg home from Delhi.

Nothing failed. The query succeeded, the numbers were internally consistent,
and the only symptom was a confident wrong answer in prose.

**Rule:** a table gets ONE read path. Where several routes must query it, use
`SELECT *` and let the coerce function define what is read — a hand-maintained
column list in three places will drift the first time a column is added, and
the drift is silent. Same failure mode as lesson 6, one layer down.

## 15. State the baseline, or two correct cards will contradict each other

On body battery the Combined card showed "Alcohol only **+10.9** — better",
while the Alcohol card showed every drinking band **worse**. Same days, same
metric, opposite conclusions, and both arithmetically right.

The cards measure against different reference groups:

| Card | Baseline | Days |
|---|---|---|
| Alcohol / Sugar | no intake of THAT one, other ignored | 15 → 59.5 |
| Combined | NEITHER intake | 4 → 43.8 |

The 4 "neither" days happened to be a bad set, 15.7 points below the wider
alcohol-free average, so everything beat them and the sign flipped.

`baselineCheck()` now detects specifically when switching to the wider baseline
would REVERSE the verdict — a difference of direction, not of degree — and the
card says which figure to trust.

A second mismatch found in the same review: "What Moves the Needle" is
weekend-MATCHED (strata measured separately, then averaged) while the impact
cards POOL days within the selected filter. Same baseline, different estimator,
so the same habit legitimately shows two numbers. Every card now states its
method.

**Rule:** any card showing a difference must say what it is a difference FROM,
and how the days were combined. Where two cards can disagree by construction,
detect it and name the more reliable one rather than leaving the reader to
reconcile them.

## 16. Model ids and request shapes rot without failing a test

Two defects that only the live API would have reported:

- `claude-sonnet-4-5` stayed in the training-plan route past its deprecation;
  it retires 2026-11-30 and the route would have started erroring on that day.
- The coach forced its tool call (`tool_choice: {type:'tool'}`). Fable 5.2/5.1
  and Sonnet 5.5 reject that with a 400, so the code quietly pinned the app to
  older models. Its fallback (`toolBlock?.input ?? {}`) would also have
  rendered a blank report as a success.

**Rule:** `tool_choice: auto` plus a prompt line naming the tool; throw when no
tool block comes back. Never put backticks inside a template-literal prompt —
that broke the build while fixing this.
**Tests:** `__tests__/model-compat.test.ts` scans the source for retired model
ids, forced tool choice and assistant prefill.

## 17. Check the installed SDK before proposing an API feature

Structured outputs were proposed as the fix for the forced tool call before
anyone looked at `package.json`: the SDK was 0.40, which has no
`output_config` at all. The plan had to be redone mid-task.

**Rule:** read the installed version (`node_modules/<pkg>/package.json`, not
just the semver range) and grep its types for the parameter before designing
around it.

## 18. A model reply is not a success until its ending is checked

A refusal and a `max_tokens` cut-off both arrive as HTTP 200. Reading
`content` without checking `stop_reason` stores an empty or half-written
report as if it had worked. The same goes for anything the model chooses that
the UI then displays as fact: an unrecognised `confidence` is shown as low,
never promoted, and a garbled sample size is shown as "not given", never as a
number.

**Tests:** `__tests__/coach-report.test.ts` (refusal, cut-off, prose instead
of JSON), `__tests__/analysis.test.ts` ("never promotes an unrecognised
confidence").

## 19. What the model writes is input, wherever it lands

The memory tool lets the model pick file paths and contents; the analysis
runner posts model-made charts back to the app. Both are validated where they
arrive: memory paths must be plain names under `/memories` (no traversal, no
deleting the root, size and count caps), and a chart is kept only if it is a
small file whose bytes really are a PNG, whatever its name says.

**Tests:** `__tests__/coach-memory.test.ts`, `__tests__/analysis.test.ts`
("drops a chart that is not a PNG").

## 20. The model reads; code decides

Four features added together (quick log, early warning, experiments, history
look-ups) all follow one split, and each would have reintroduced an old bug
without it:

- **Quick log.** The model reports what was eaten or drunk; code computes the
  units, adds to the day, and leaves every field nobody mentioned untouched.
  Letting the model fill the row would have written zeros for unmentioned
  fields (lesson 4) the first time someone logged only a beer.
- **Early warning.** Whether something is off is computed (median and MAD
  against the previous four weeks, two of three days, at least one
  physiological signal). The model only words it, and is told the check is
  authoritative. Known causes — alcohol, travel, a heavy block — are named
  rather than hidden (lesson 6).
- **Experiments.** An unlogged day is unknown, never "kept". The comparison is
  weekend-night against weekend-night (lesson 6), and each outcome carries its
  own direction (lesson 3).
- **History look-ups.** The model picks a table, column and function; averages
  and bests are computed in code over the same tables the reports use, and an
  empty cell takes no part in any of them.

**Rule:** anything that is arithmetic, a threshold, or a null-versus-zero
decision is code with a test. A model output that the UI shows as a fact
(a verdict, a confidence, a sample size) is validated, and an unrecognised
value falls to the cautious reading — "cannot check", never "agrees".

**Tests:** `quick-log.test.ts`, `early-warning.test.ts`, `experiments.test.ts`,
`history-tools.test.ts`, and the card-check cases in `analysis.test.ts`.

## 21. A diary of parts needs to know when the whole is in

The 1-5 meal score was replaced by a meal diary: each meal is logged by
sentence or photo, and the day's nutrition row is derived from the day's meals
(`lib/meals.ts`). The trap is the one in lesson 4, one level up: with lunch
logged and nothing else, "no alcohol among the meals so far" is not "no
alcohol today", and 500 kcal so far is not a 500 kcal day.

**Rules.**
- A positive amount in the meals is known. A zero is known only when the day
  was marked complete (or, for alcohol, the person said "none today").
- Day totals exist only for a complete day in which every meal has an
  estimate; otherwise they are null, and reach the model as empty cells.
- The diary is the single source of truth on a day that has one. Amounts typed
  by hand earlier are carried into the diary as one entry — not lost, not
  counted twice — and the form's fields become read-only for that day.
- The model never decides a day was alcohol-free or complete; those come only
  from the person's own words, and "no alcohol" alongside a listed drink is
  asked about, not resolved.

**Tests:** `__tests__/meals.test.ts` ("does NOT report zero alcohol or sweets
just because none are logged yet", "reports no day totals for a partial day",
carry-over round trip), and the meals cases in `quick-log.test.ts`.

## 22. A difference needs both of its halves whole

Net calories = eaten − burned. The Garmin sync runs at 04:00 and also reads
"today", when the watch has counted four hours; subtracting that from a full
day of food shows a 1,700 kcal surplus that never happened. The mirror image
is a full day's burn against a half-logged diary.

**Rule:** a day gets a net figure only when the diary day is complete AND the
burn figure was synced after the day ended (`kcal_synced_at`, checked in
`isBurnFinal`). Anything else is shown as partial or pending and stays out of
every average. A weekly weight rate is stated only with seven such days.
**Tests:** `__tests__/energy-balance.test.ts`, and "writes calories burned
only for days synced after they ended" in `raw-data.test.ts`.

## 23. A duplicate guard asks; it does not decide

The same meal entered twice doubles the day's calories, but the same dish at
lunch and dinner, or a second coffee, is real. The guard therefore flags only
the same thing at the same sitting (same day, much the same words, and the
same kind of meal or within an hour), sets it aside in the proposal with an
"Add anyway" choice, and never drops or adds anything on its own. A separate
server check skips an identical entry re-sent within two minutes, which is a
double click, not a second helping.
**Tests:** "likelyDuplicate" in `meals.test.ts`, and the duplicate cases in
`quick-log.test.ts`.

## 24. Two records of the same thing must not be added together

A day typed by hand as 5.5 alcohol units was then described in Quick log,
dinner wine included. The carry-over kept the typed amounts as a diary entry
AND the dinner entry brought its own 5.5: the day showed 11. The duplicate
guard did not see it, because it compares meals with meals and the carried
entry reads "Logged by hand earlier".

**Rule:** amounts typed by hand are the day's totals. Diary meals added for
that day count TOWARD them: the carried entry is reduced by what the meals
contain and removed once they explain all of it (`reduceCarryOver`). Before
adding a second source of the same quantity, decide which one is the total.
**Tests:** `__tests__/meals.test.ts` — "does not count the wine twice when the
day is described after being typed", with the real numbers.

Found from the same screenshot: an eating window of "0 h" from a single timed
meal (now needs two), and meals left unsorted although their descriptions
began "Morgenmad:", "Frokost:", "Aftensmad:" (the description's own label is
now read, in Danish and English).

## 25. A maximum over incomplete data is a lower bound, not a value

"Last food" is the latest time among the day's entries. With lunch timed and
dinner untimed it read 12:30 — wrong, not merely unknown — and on any partial
day it can only ever be a lower bound. The same holds for the first meal and
the eating window. Totals were already withheld on partial days; maxima and
minima need the same rule.

**Rule:** last food, first food and the eating window are reported only when
the day is complete AND every entry with food has a time. Otherwise null, with
the entries that need a time named in the diary and flagged in Quick log (a
time box on the proposal), so the fix is one step.

Also from this change: correlation on the detailed numbers uses thirds of the
person's own complete days (highest third vs lowest) instead of fixed
thresholds, which were guesses about what is "a lot" for them. A partial day
has no value and is left out, never counted as low.
**Tests:** "last food is unknown rather than wrong" in `meals.test.ts`;
`nutrition-detail.test.ts` ("leaves a day with no total out, never treating it
as low", direction and dose-response on known numbers).

## 26. A coaching signal is only as honest as the day it judges

Step coaching reads yesterday and the weeks before, never today: the overnight
sync also reads "today" a few hours in, and a goal check on that count would
call every morning a failure. Days with no count are unknown (not zero, not a
miss) and end a streak instead of extending it; the weekday pattern needs four
samples of a weekday before it is named; and the nudge is computed by code
(gap, minutes of walking at a stated 100 steps a minute) so the brief and the
chat can only reword it.
**Tests:** `__tests__/step-coach.test.ts` ("never uses today", "treats a day
with no count as unknown"); the brief cases in `early-warning.test.ts`.

Also: before telling someone their max heart rate is wrong, look at the data.
Two maximal ramp tests months apart both peaked at 169-170 with the rate still
climbing when the effort ended; a recalled "about 166" was a hard ride, not a
maximum.

## 27. Several writers, one quantity: never add the sources together

The Steps vs Target card showed a 1-year average of 10,762 while Garmin's own
figure was 8,030. The Apple Health export holds one step record PER SOURCE
(iPhone, a watch, and any app that writes into Health, Garmin Connect
included), and the importer added every record it saw, so a walk was counted
once for each source that recorded it. Stored months before June read 12-14k;
the Garmin-synced months after it read 7-9k, close to Garmin's own average.
Same family as lesson 8 (same word, different device), found because the
person knew the right answer and checked.

**Rule:** when more than one source can report the same quantity, never add
them. For steps the person chose the order: GARMIN is the master and the
IPHONE fills only where Garmin recorded nothing (charging, not worn); an Apple
Watch and other apps are ignored (`lib/step-sources.ts`). For flights climbed,
which has no such preference, the busiest single source is taken. A figure that disagrees with the person's own
trusted device by 30% is a data defect until shown otherwise.
**Tests:** `__tests__/apple-health-parser.test.ts` ("does not add the same
steps up once per source", with the real shape: iPhone 6,000, watch 5,200,
Garmin Connect 5,900 for one day).
**Not fixed by code:** days already stored keep the old totals until they are
overwritten, by a Garmin backfill or a fresh Apple Health import.

## 28. A rule about which write wins must not depend on which write comes first

Two importers write the same daily step count, an overnight Garmin sync and an
occasional Apple Health upload. "Last writer wins" made the answer depend on
the order they ran. `steps` is now DERIVED from per-source columns
(`steps_garmin`, `steps_apple`, `steps_fill`), so any order gives the same
result, and a fill from the phone counts only if the export's account of
Garmin's day agrees with Garmin's own within 20%.

The SQL that does this lives in `lib/wellness-upsert.ts` and is run against a
real Postgres (PGlite) in `__tests__/wellness-upsert.test.ts`, including both
orders of arrival, locked values, rows stored before the columns existed, and
a check that the SQL and the TypeScript `deriveSteps()` agree. A mistake in
that statement would break the daily sync, and a type check cannot see inside
a SQL string.
