# Lessons Learned

Read this file at the start of any coding task. Every entry is a real bug that happened in this project.

---

## TypeScript

### Keep ALL wellness shape copies in sync — there are exactly 3
**Mistake (×2):** Adding fields to `WellnessRecord` in `types/index.ts` but forgetting the local copies, causing TS build failures.  
**The 3 copies that must always match `types/index.ts`:**
1. `lib/db.ts` — `WellnessRow` type (line ~310) + `upsertWellness` INSERT/UPDATE columns + `coerceWellness`
2. `lib/garmin-parser.ts` — `emptyWellness()` return object
3. `lib/apple-health-parser.ts` — inline object literal inside `getOrCreate()`

**Verification command before committing any wellness field change:**
```
grep -rn "emptyWellness\|WellnessRow\|metabolic_age" garmin-fitness-app/lib/
```
Every hit must include the new field. Also update `upsertWellness` column count (`j * N` placeholder arithmetic).

**After deploying new columns, ALWAYS call `/api/init-db` immediately** (POST request) to run the `ALTER TABLE ADD COLUMN IF NOT EXISTS` migrations on the live DB. If this is skipped, `SELECT *` returns rows without those keys — they come back as `undefined` (not `null`) and crash any component that passes them to Recharts or does arithmetic.

**Guard against undefined in components that use new wellness fields:** use a `safe()` helper:
```ts
const safe = (v: number | null | undefined): number | null =>
  v != null && !isNaN(v) ? v : null;
```

**Wrap new chart components in `<ChartErrorBoundary>`** so a crash in one chart never takes down the whole dashboard. `components/ChartErrorBoundary.tsx` exists for this.

**Charts that show "latest reading" or compute their own rolling windows (last 30/90 days) must receive the unfiltered `allWellness`/`allActivities` prop, not the period-filtered `wellness`/`activities`.** `Dashboard.tsx` filters `wellness` to the user's selected period (1W/1M/.../1Y); a metric whose most recent data point falls outside that window (e.g. `respiratory_rate`, `walking_asymmetry_pct`, `oxygen_saturation`, `mindful_minutes` — only present 2021-2023 in this dataset) will silently never render, even though `hasAHData` checks pass overall (because *other* fields in the same array do have recent data). Symptom: only some of N expected tiles show up, no error. Fix: use `sortedAllWellness` (from `allWellness`) for any component that does its own date-window math.

**Never call `.toFixed()` directly on a value typed `number | null`.** Even after `coerceWellness`, Postgres DECIMAL columns can surface as numeric strings in edge cases (`"15.0"`). `"15.0" != null` is `true` and `!isNaN("15.0")` is `true` — a naive `safe()` guard lets the string through, then `"15.0".toFixed` is `undefined` → "t.toFixed is not a function" crash. Always use a `fmt()`/`safe()` helper that does `Number(v)` + `isFinite()` check, never just an `isNaN()` check on the raw value.

---

### Named interface ≠ index signature
**Mistake:** Passing a named interface (e.g. `ActivitySampleSummary[]`) where `Record<string, unknown>[]` was expected — TS rejects this even if all fields are compatible, because named interfaces don't satisfy index signatures.  
**Fix:** Use `any[]` (with `eslint-disable` comment) for cross-module bridge parameters where the receiver doesn't inspect fields. Never use `Record<string, unknown>` as a generic "object array" parameter type.

---

## Next.js App Router

### Every DB-reading API route needs `force-dynamic`
**Mistake (×2):** `/api/activities/[id]/samples/route.ts` was missing `export const dynamic = 'force-dynamic'`. Next.js statically cached the empty `{"samples":[]}` response at build time. Every request returned the stale empty response with no error. A later review found `/api/ftp`, `/api/insights`, and `/api/ai-summary` with the same gap.  
**Fix:** Add `export const dynamic = 'force-dynamic'` to every route that queries the database.  
**Checklist:** When creating a new API route, add this as the first export. When debugging a route returning wrong/empty data, check for this first.

---

## GitHub Actions / CI

### Workflow `run:` path must match the file actually being developed
**Mistake:** `.github/workflows/garmin-sync.yml` ran `python scripts/garmin_sync.py` (a stale root copy) instead of `python garmin-fitness-app/scripts/garmin_sync.py` (the real one). CI showed green but ran dead code.  
**Lesson:** A passing CI run proves the script ran, not that it ran the right one. Always verify the `run:` path in the workflow matches the file being actively developed.

### Files referenced in CI must be git-tracked
**Mistake:** `garmin-fitness-app/scripts/requirements.txt` was untracked locally, so the GitHub Actions runner couldn't find it and the job failed.  
**Fix:** Point all CI file references to tracked files. Check with `git ls-files <path>` before pushing a workflow change.

### "Re-run jobs" reruns the old commit — use "Run workflow" for new commits
**Mistake:** Clicking "Re-run jobs" on a failed run doesn't pick up new commits — it reruns the exact same SHA. The fix was already pushed but the rerun showed the same failure.  
**Fix:** Always use "Run workflow" (workflow_dispatch) to test the latest commit.

---

## Postgres / @vercel/postgres

### Pooled `sql` reads can lag behind writes — read-after-write must use `createClient()`
**Mistake:** `/api/data/wellness` PATCH wrote via a direct connection but the GET read via the pooled `sql` tagged template. PgBouncer served the read from a lagged Neon replica, so a saved edit "vanished" on the next fetch — reported as a save bug three times before the real cause was found.  
**Fix:** Any route in a read-after-write flow (edit → refetch) must use `createClient()` (POSTGRES_URL_NON_POOLING, direct to primary) for BOTH the write and the read. Also: `sql.query()` is not a valid method on the pooled `sql` export — it silently no-ops; use `createClient()` + `client.query()` for dynamic SQL.

### Migration order in initializeDatabase: CREATE before ALTER
**Mistake:** `ALTER TABLE user_settings ADD COLUMN ...` statements were placed before the `CREATE TABLE IF NOT EXISTS user_settings` block. On any fresh database the first ALTER throws `relation does not exist` and the whole bootstrap aborts. It only worked in prod because the table already existed.  
**Also:** every table a route queries must actually be created in `initializeDatabase` — `sync_log` was queried by `/api/sync-log` but never created anywhere.  
**Checklist:** new column → put the ALTER *after* its table's CREATE; new table queried by a route → add its CREATE TABLE IF NOT EXISTS.

### Clearing a bad synced value without locking it = it comes back
**Mistake:** The anomaly detector's "Clear field" nulled a wellness field without setting the lock, so the next Garmin sync re-imported the same bad value (e.g. another person using the smart scale).  
**Fix:** Any user-initiated correction of synced data must also mark the field locked (`lock: true`), and mutations must check `res.ok` before updating UI state — a silently failed write that still updates the UI is indistinguishable from this bug.

---

## Vercel / Deployment

### Cross-origin Blob uploads hang silently at 0%
**Mistake:** Upload flow got a token from `/api/upload` (same-origin) then POSTed to `*.public.blob.vercel-storage.com` (cross-origin). Browser silently hung — no error, no progress.  
**Fix:** Route all uploads through a same-origin Next.js API route. Never POST binary data cross-origin from the browser.

---

## Home Hub (device integrations)

### The local venv was Python 3.9 but the code uses 3.10+ syntax
**Finding:** `home-hub/backend/.venv` was built with the macOS Command Line Tools Python (3.9.6). The code uses PEP 604 unions (`str | None`) in *evaluated* positions (function return annotations), which raise `TypeError` at import on 3.9. The app only ever ran on Vercel (Python 3.12); locally `import main` crashed. Mock data on the deployed site masked this.
**Fix:** Installed `uv` (`~/.local/bin`, no system change) and rebuilt the venv on Python 3.12 to match the Vercel runtime: `uv venv --python 3.12 .venv`. Always check `python --version` of the venv matches prod before debugging "works deployed, not locally".

### pyit600 0.5.1 is incompatible with modern async-timeout/aiohttp
**Mistake:** Added `pyit600` for the Salus iT600 gateway. It does `with async_timeout.timeout(...)` (sync context manager), removed in async-timeout 4.x; aiohttp pulls async-timeout 5.x → `TypeError: 'Timeout' object does not support the context manager protocol`.
**Fix:** The protocol is tiny — reimplemented it directly with `httpx` + `cryptography`: key = `md5("Salus-"+euid.lower()).digest()+bytes(16)`, fixed IV, AES-128-CBC, PKCS7(128). POST encrypted JSON to `http://host:80/deviceid/{read,write}`. Dropping the fragile lib was cheaper than pinning a dependency tangle.

### pysnmp 6.2.x asyncio API differs from the 7.x examples
**Finding:** Most current docs/examples show `pysnmp.hlapi.v1arch.asyncio` + `await UdpTransportTarget.create(...)` (that's 7.x). On 6.2.6 the path is `pysnmp.hlapi.asyncio`, the call is `getCmd` (camelCase) with `SnmpEngine()` + `ContextData()`, and `UdpTransportTarget((host,161), timeout=, retries=)` is constructed **synchronously** (no `.create()`). Use `CommunityData("public", mpModel=1)` for SNMPv2c.
**Also:** pysnmp's asyncio API needs a running loop; calling it from a thread (via `asyncio.to_thread`) requires creating a fresh `new_event_loop()` inside that thread.

### Brother maintenance OID decoding
Brother lasers bypass the standard `prtMarkerSupplies` table. Toner/drum/belt/fuser live in one OctetString at `1.3.6.1.4.1.2435.2.3.9.4.2.1.5.5.8.0`, encoded as repeating `[item_id:1][0x01][len:1][value:len]` records, `0xFF` terminated. Toner-remaining item ids `6f/70/71/72` (K/C/M/Y) and part-remaining `41`(drum)/`69`(belt)/`6a`(fuser) are per-10000 → divide by 100 for %. Map from `bieniu/brother` `const.py`. The model OID often returns the IEEE-1284 device-ID string (`MFG:...;MDL:...;`) — parse the `MDL:` token.

### Salus iT600 local mode prerequisites
Live local data needs (1) "Local WiFi Mode" enabled in the Salus/Neotherm phone app, and (2) the gateway EUID from the sticker. When rejected, the gateway returns a fixed ~33-byte (non-16-multiple) blob that won't AES-decrypt — use `len(body) % 16 != 0` as the "not set up" signal and fall back to mock.

### Keep heavy/native imports lazy for Vercel serverless
`api/index.py` imports `main`, which imports every device module at top level. Keep `pysnmp`, `cryptography`, etc. imported *inside* methods (not at module top) so the serverless cold-start import succeeds with only the slim root `requirements.txt` (fastapi/uvicorn/httpx/python-dotenv). Verified by stubbing those modules to `None` in `sys.modules` before importing `api/index.py`.

## Garmin / Apple Health Data

### Garmin bulk export ZIP has zero .fit files
**Finding (confirmed empirically):** Garmin's "Export Your Data" ZIP (352 files) contains only JSON/DB dumps — no `.fit` binary activity files at all. Per-second HR/power/cadence is only available via `api.get_activity_details()` in the Garmin Connect API.  
**Lesson:** Do not attempt .fit extraction from the bulk export. The Python sync script is the only source of per-second sample data.

### Apple Health import creates duplicate activities
**Finding:** Uploading an Apple Health export creates `ah_*` garmin_id records alongside Garmin API records for the same workouts. The `ah_*` copies have 0 `activity_samples` and show "No data" to the user.  
**Fix:** Deduplicate in `/api/activities` — prefer numeric garmin_id (Garmin) over `ah_*` (Apple Health) for the same datetime/type within 5 minutes. Keep Apple Health-only records (no Garmin counterpart).

### Per-second samples appeared missing but were actually there
**Root cause chain:**
1. GitHub Actions ran the stale root-level `scripts/garmin_sync.py` (no sample code) — fixed by correcting the workflow path.
2. `/api/activities/[id]/samples` was statically cached empty — fixed by adding `force-dynamic`.
3. User was clicking Apple Health duplicate activities (id 13xxx) which legitimately have 0 samples, not the Garmin originals (id 6xxx) which had 265–371 samples.  
**Lesson:** When per-second data appears missing, check all three layers: CI ran the right script? Route has `force-dynamic`? User is looking at the Garmin record not the `ah_*` duplicate?
