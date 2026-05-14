import JSZip from 'jszip';
import { ParsedGarminData } from '@/types';

// ─── helpers ───────────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function posNum(v: unknown): number | null {
  const n = num(v);
  return n != null && n > 0 ? n : null;
}

function normalizeActivityType(sportType: string, activityType: string): string {
  const s = (sportType || activityType || '').toLowerCase();
  if (s.includes('run') || s.includes('trail')) return 'running';
  if (s.includes('cycl') || s.includes('bike') || s.includes('ride') || s.includes('virtual')) return 'cycling';
  if (s.includes('walk') || s.includes('hik') || s.includes('steps')) return 'walking';
  if (s.includes('swim')) return 'swimming';
  if (s.includes('strength') || s.includes('gym') || s.includes('yoga') || s.includes('fitness')) return 'strength';
  return 'other';
}

type WellnessRow = ParsedGarminData['wellness'][0];

function emptyWellness(date: string): WellnessRow {
  return { date, steps: null, resting_hr: null, hrv_rmssd: null, sleep_hours: null, sleep_score: null, stress_score: null, body_battery: null };
}

// ─── activities parser ──────────────────────────────────────────────────────
// File: DI_CONNECT/DI-Connect-Fitness/*_summarizedActivities.json
// Format: [{ "summarizedActivitiesExport": [ ...activity objects... ] }]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseSummarizedActivities(json: string, out: ParsedGarminData['activities']): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try { data = JSON.parse(json); } catch { return; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any[] = [];
  if (Array.isArray(data)) {
    for (const item of data) {
      if (Array.isArray(item?.summarizedActivitiesExport)) {
        raw.push(...item.summarizedActivitiesExport);
      }
    }
  }

  for (const a of raw) {
    if (!a.activityId || !a.beginTimestamp) continue;
    const date = new Date(Number(a.beginTimestamp));
    if (isNaN(date.getTime())) continue;

    // All distances/speeds are in centimetres and cm/ms respectively
    // elevationGain is also in centimetres
    const elevGain = a.elevationGain != null ? Number(a.elevationGain) / 100 : null; // cm → m

    // cadence: prefer run cadence for running, bike cadence for cycling
    const cadence = posNum(a.avgRunCadence) ?? posNum(a.avgBikeCadence) ?? null;

    // speed: cm/ms → km/h  (1 cm/ms = 36 km/h)
    const avgSpeedKmh = a.avgSpeed != null && Number(a.avgSpeed) > 0
      ? Number(a.avgSpeed) * 36
      : null;

    out.push({
      garmin_id: String(a.activityId),
      activity_type: normalizeActivityType(a.sportType ?? '', a.activityType ?? ''),
      date: date.toISOString(),
      title: a.name || '',
      distance_km: Number(a.distance ?? 0) / 100000, // cm → km
      duration_seconds: Math.round(Number(a.duration ?? 0) / 1000), // ms → s
      calories: Math.round(Number(a.calories ?? 0)),
      avg_hr: posNum(a.avgHr) ? Math.round(Number(a.avgHr)) : null,
      max_hr: posNum(a.maxHr) ? Math.round(Number(a.maxHr)) : null,
      training_effect: null,
      avg_cadence: cadence ? Math.round(cadence) : null,
      avg_speed_kmh: avgSpeedKmh,
      tss: null,
      avg_power: posNum(a.avgPower) ? Math.round(Number(a.avgPower)) : null,
      max_power: posNum(a.maxPower) ? Math.round(Number(a.maxPower)) : null,
      elevation_gain: elevGain != null && elevGain > 0 ? elevGain : null,
    });
  }
}

// ─── UDS wellness parser ────────────────────────────────────────────────────
// Files: DI_CONNECT/DI-Connect-Aggregator/UDSFile_*.json
// One record per calendar day; contains steps, resting HR, stress.

function parseUDSFile(json: string, map: Map<string, WellnessRow>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any[];
  try { data = JSON.parse(json); } catch { return; }
  if (!Array.isArray(data)) return;

  for (const day of data) {
    const date = day.calendarDate as string | undefined;
    if (!date) continue;

    const stress = num(day.allDayStress?.aggregatorList?.[0]?.averageStressLevel);
    const existing = map.get(date) ?? emptyWellness(date);

    map.set(date, {
      ...existing,
      steps: num(day.totalSteps) ?? existing.steps,
      resting_hr: num(day.restingHeartRate) ?? existing.resting_hr,
      stress_score: stress != null && stress > 0 ? Math.round(stress) : existing.stress_score,
    });
  }
}

// ─── sleep parser ───────────────────────────────────────────────────────────
// Files: DI_CONNECT/DI-Connect-Wellness/*_sleepData.json
// One record per night; contains duration breakdown and sleep score.

function parseSleepFile(json: string, map: Map<string, WellnessRow>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any[];
  try { data = JSON.parse(json); } catch { return; }
  if (!Array.isArray(data)) return;

  for (const s of data) {
    const date = s.calendarDate as string | undefined;
    if (!date) continue;

    const totalSecs =
      (Number(s.deepSleepSeconds ?? 0)) +
      (Number(s.lightSleepSeconds ?? 0)) +
      (Number(s.remSleepSeconds ?? 0));
    const hours = totalSecs > 0 ? totalSecs / 3600 : null;
    const score = num(s.sleepScores?.overallScore);

    const existing = map.get(date) ?? emptyWellness(date);
    map.set(date, {
      ...existing,
      sleep_hours: hours ?? existing.sleep_hours,
      sleep_score: score ?? existing.sleep_score,
    });
  }
}

// ─── main export ────────────────────────────────────────────────────────────

export async function parseGarminZip(buffer: ArrayBuffer): Promise<ParsedGarminData> {
  const zip = await JSZip.loadAsync(buffer);

  const activities: ParsedGarminData['activities'] = [];
  const wellnessMap = new Map<string, WellnessRow>();

  for (const [filePath, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const nameLower = filePath.split('/').pop()?.toLowerCase() ?? '';

    // Skip macOS metadata files
    if (filePath.includes('__MACOSX') || nameLower.startsWith('._')) continue;

    if (nameLower.includes('summarizedactivities') && nameLower.endsWith('.json')) {
      const content = await file.async('string');
      parseSummarizedActivities(content, activities);
    } else if (nameLower.startsWith('udsfile') && nameLower.endsWith('.json')) {
      const content = await file.async('string');
      parseUDSFile(content, wellnessMap);
    } else if (nameLower.includes('sleepdata') && nameLower.endsWith('.json')) {
      const content = await file.async('string');
      parseSleepFile(content, wellnessMap);
    }
  }

  return {
    activities,
    wellness: Array.from(wellnessMap.values()),
  };
}
