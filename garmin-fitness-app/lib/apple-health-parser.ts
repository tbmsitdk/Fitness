import JSZip from 'jszip';
import { ParsedGarminData } from '@/types';

// ── Activity type mapping ──────────────────────────────────────────────────────

const WORKOUT_TYPE_MAP: Record<string, string> = {
  'Running':                       'running',
  'TrailRunning':                  'running',
  'Cycling':                       'cycling',
  'Walking':                       'walking',
  'Hiking':                        'walking',
  'Swimming':                      'swimming',
  'LapSwimming':                   'swimming',
  'OpenWaterSwimming':             'swimming',
  'TraditionalStrengthTraining':   'strength',
  'FunctionalStrengthTraining':    'strength',
  'HighIntensityIntervalTraining': 'strength',
  'CoreTraining':                  'strength',
  'CrossTraining':                 'strength',
  'Yoga':                          'yoga',
  'Pilates':                       'yoga',
  'MindAndBody':                   'yoga',
};

function mapWorkoutType(hkType: string): string {
  const key = hkType.replace('HKWorkoutActivityType', '');
  if (WORKOUT_TYPE_MAP[key]) return WORKOUT_TYPE_MAP[key];
  // Fuzzy fallback
  const l = key.toLowerCase();
  if (l.includes('run'))    return 'running';
  if (l.includes('cycl') || l.includes('bike')) return 'cycling';
  if (l.includes('walk') || l.includes('hik'))  return 'walking';
  if (l.includes('swim'))   return 'swimming';
  if (l.includes('strength') || l.includes('gym') || l.includes('hiit')) return 'strength';
  return 'other';
}

function humanLabel(hkType: string): string {
  return hkType
    .replace('HKWorkoutActivityType', '')
    .replace(/([A-Z])/g, ' $1')
    .trim();
}

// ── Attribute parser ───────────────────────────────────────────────────────────

// Extracts a named attribute from an XML tag attribute string.
// Apple Health attribute values never contain escaped quotes so this is safe.
function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(attrs);
  return m ? m[1] : null;
}

// FNV-1a 32-bit hash → base-36 string
function fnv32(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

// ── Locale-agnostic Apple Health XML finder ───────────────────────────────────
// Apple Health exports use localized folder/file names on non-English iPhones
// (e.g. Danish: apple_health_eksport/eksport.xml). We avoid content-peeking
// (which decompresses the whole potentially-300MB XML just to read 512 bytes).
// Instead we rely on filename heuristics — Apple Health ALWAYS exports two files:
//   export.xml      (or localized: eksport.xml, etc.)  — the main data file
//   export_cda.xml  (or localized: eksport_cda.xml)    — CDA companion
// Finding the _cda.xml companion is a zero-decompression Apple Health marker.

function findAppleHealthXmlSync(zip: JSZip): JSZip.JSZipObject | null {
  // 1. Try well-known English path first
  const known = zip.file('apple_health_export/export.xml');
  if (known) return known;

  // 2. Find the CDA companion file (zero decompression, just filename scan)
  const cdaFiles = zip.file(/_cda\.xml$/i);
  if (cdaFiles.length > 0) {
    // Main export XML sits next to _cda.xml with same base name minus "_cda"
    const mainPath = cdaFiles[0].name.replace(/_cda\.xml$/i, '.xml');
    const main = zip.file(mainPath);
    if (main) return main;
  }

  // 3. Fallback: any top-level (depth ≤ 1) .xml that isn't a route/ECG/cda file
  const candidates = zip.file(/\.xml$/i).filter(f => {
    const n = f.name.toLowerCase();
    return !n.includes('workout-routes') &&
           !n.includes('electrocardiograms') &&
           !n.includes('_cda');
  });
  // Single candidate → almost certainly the main export
  if (candidates.length === 1) return candidates[0];
  // Multiple: prefer the one in a folder whose name contains "health" or the export root
  const preferred = candidates.find(f => {
    const n = f.name.toLowerCase();
    return n.includes('health') || n.includes('eksport') || n.includes('export');
  });
  return preferred ?? null;
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function parseAppleHealthZip(buffer: ArrayBuffer): Promise<ParsedGarminData & { source: 'apple' }> {
  const zip = await JSZip.loadAsync(buffer);
  const xmlFile = findAppleHealthXmlSync(zip);

  if (!xmlFile) {
    throw new Error(
      'No Apple Health export XML found in this ZIP.\n' +
      'Export via iPhone Health app → top-right avatar → Export All Health Data.'
    );
  }

  const xmlText = await xmlFile.async('text');
  const result = parseXML(xmlText);
  return { ...result, source: 'apple' };
}

/** Detect if an ArrayBuffer is an Apple Health ZIP (vs Garmin). */
export async function isAppleHealthZip(buffer: ArrayBuffer): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    return findAppleHealthXmlSync(zip) !== null;
  } catch {
    return false;
  }
}

// ── XML parser ────────────────────────────────────────────────────────────────

type WellnessRow = ParsedGarminData['wellness'][0];

const SLEEP_ASLEEP_VALUES = new Set([
  'HKCategoryValueSleepAnalysisAsleep',
  'HKCategoryValueSleepAnalysisAsleepUnspecified',
  'HKCategoryValueSleepAnalysisAsleepCore',
  'HKCategoryValueSleepAnalysisAsleepDeep',
  'HKCategoryValueSleepAnalysisAsleepREM',
]);

// Types we actually care about — used to skip irrelevant Record lines fast
const RELEVANT_TYPES = [
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  'HKQuantityTypeIdentifierBodyMass',
  'HKQuantityTypeIdentifierVO2Max',
  'HKCategoryTypeIdentifierSleepAnalysis',
];

function parseXML(xml: string): ParsedGarminData {
  const activities: ParsedGarminData['activities'] = [];
  const wellnessMap = new Map<string, WellnessRow>();

  function getOrCreate(date: string): WellnessRow {
    const d = date.substring(0, 10);
    if (!wellnessMap.has(d)) {
      wellnessMap.set(d, {
        date: d,
        steps: null,
        resting_hr: null,
        hrv_rmssd: null,
        sleep_hours: null,
        sleep_score: null,
        stress_score: null,
        body_battery: null,
        weight_kg: null,
        vo2max: null,
        fitness_age: null,
      });
    }
    return wellnessMap.get(d)!;
  }

  // ── Pre-filter pass ────────────────────────────────────────────────────────
  // Apple Health exports contain millions of HR-sample and accelerometer Records
  // we don't need. A fast line-level filter cuts the payload by >95% before any
  // regex runs on it.
  const lines = xml.split('\n');
  const kept: string[] = [];
  let inWorkout = false;

  for (const line of lines) {
    if (line.includes('<Workout')) { inWorkout = true; }
    if (inWorkout) { kept.push(line); }
    if (line.includes('</Workout>')) { inWorkout = false; continue; }
    if (!inWorkout && RELEVANT_TYPES.some(t => line.includes(t))) {
      kept.push(line);
    }
  }

  const filtered = kept.join('\n');

  // ── Parse <Record .../> elements ──────────────────────────────────────────
  // Records are self-closing in Apple Health exports.
  const RECORD_RE = /<Record\s([\s\S]*?)\/>/g;
  let m: RegExpExecArray | null;

  while ((m = RECORD_RE.exec(filtered)) !== null) {
    const a = m[1];
    const type      = attr(a, 'type') ?? '';
    const value     = attr(a, 'value') ?? '0';
    const startDate = attr(a, 'startDate') ?? '';
    const endDate   = attr(a, 'endDate') ?? startDate;
    if (!startDate) continue;

    switch (type) {
      case 'HKQuantityTypeIdentifierStepCount': {
        const w = getOrCreate(startDate);
        w.steps = (w.steps ?? 0) + Math.round(parseFloat(value));
        break;
      }
      case 'HKQuantityTypeIdentifierRestingHeartRate': {
        const w = getOrCreate(startDate);
        w.resting_hr = Math.round(parseFloat(value));
        break;
      }
      case 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN': {
        // Keep last SDNN reading of the day (typically 1 overnight measurement)
        const w = getOrCreate(startDate);
        w.hrv_rmssd = Math.round(parseFloat(value) * 10) / 10;
        break;
      }
      case 'HKQuantityTypeIdentifierBodyMass': {
        const unit = attr(a, 'unit') ?? 'kg';
        let kg = parseFloat(value);
        if (unit === 'lb') kg *= 0.453592;
        const w = getOrCreate(startDate);
        w.weight_kg = Math.round(kg * 10) / 10;
        break;
      }
      case 'HKQuantityTypeIdentifierVO2Max': {
        const w = getOrCreate(startDate);
        w.vo2max = Math.round(parseFloat(value) * 10) / 10;
        break;
      }
      case 'HKCategoryTypeIdentifierSleepAnalysis': {
        if (!SLEEP_ASLEEP_VALUES.has(value)) break;
        const start = new Date(startDate);
        const end   = new Date(endDate);
        const hours = (end.getTime() - start.getTime()) / 3_600_000;
        if (hours <= 0 || hours > 14) break; // sanity check
        // Attribute sleep to the morning (wake-up) date
        const sleepDate = endDate.substring(0, 10);
        const w = getOrCreate(sleepDate);
        w.sleep_hours = Math.round(((w.sleep_hours ?? 0) + hours) * 100) / 100;
        break;
      }
    }
  }

  // ── Parse <Workout ...>...</Workout> blocks ────────────────────────────────
  const WORKOUT_RE = /<Workout\s([\s\S]*?)>([\s\S]*?)<\/Workout>/g;

  while ((m = WORKOUT_RE.exec(filtered)) !== null) {
    const a      = m[1];
    const inner  = m[2];

    const hkType      = attr(a, 'workoutActivityType') ?? '';
    const startDate   = attr(a, 'startDate') ?? '';
    if (!startDate || !hkType) continue;

    const durationMin = parseFloat(attr(a, 'duration') ?? '0');
    const durationSec = Math.round(durationMin * 60);
    if (durationSec < 60) continue; // skip accidental micro-entries

    const distRaw  = attr(a, 'totalDistance');
    const distUnit = attr(a, 'totalDistanceUnit') ?? 'km';
    let distKm = distRaw ? parseFloat(distRaw) : 0;
    if (distUnit === 'mi') distKm *= 1.60934;

    const calRaw  = attr(a, 'totalEnergyBurned');
    const calories = calRaw ? Math.round(parseFloat(calRaw)) : 0;

    // WorkoutStatistics for HR and elevation
    let avgHr:   number | null = null;
    let maxHr:   number | null = null;
    let elevGain: number | null = null;

    const STAT_RE = /<WorkoutStatistics\s([\s\S]*?)\/>/g;
    let sm: RegExpExecArray | null;
    while ((sm = STAT_RE.exec(inner)) !== null) {
      const sa   = sm[1];
      const sType = attr(sa, 'type') ?? '';
      if (sType === 'HKQuantityTypeIdentifierHeartRate') {
        const avg = attr(sa, 'average');
        const max = attr(sa, 'maximum');
        if (avg) avgHr = Math.round(parseFloat(avg));
        if (max) maxHr = Math.round(parseFloat(max));
      }
      if (
        sType === 'HKQuantityTypeIdentifierFlightsClimbed' ||
        sType === 'HKQuantityTypeIdentifierElevationAscended'
      ) {
        const sum = attr(sa, 'sum');
        if (sum) elevGain = Math.round(parseFloat(sum));
      }
    }

    // MetadataEntry for elevation
    if (!elevGain) {
      const META_RE = /<MetadataEntry\s([\s\S]*?)\/>/g;
      while ((sm = META_RE.exec(inner)) !== null) {
        const ma  = sm[1];
        const key = attr(ma, 'key') ?? '';
        if (key === 'HKElevationAscended') {
          elevGain = Math.round(parseFloat(attr(ma, 'value') ?? '0'));
          break;
        }
      }
    }

    const activityType = mapWorkoutType(hkType);
    const speedKmh = durationSec > 0 && distKm > 0
      ? Math.round((distKm / (durationSec / 3600)) * 100) / 100
      : null;

    activities.push({
      garmin_id:        `ah_${fnv32(startDate + hkType)}`,
      activity_type:    activityType,
      date:             new Date(startDate).toISOString(),
      title:            humanLabel(hkType),
      distance_km:      Math.round(distKm * 10000) / 10000,
      duration_seconds: durationSec,
      calories,
      avg_hr:           avgHr,
      max_hr:           maxHr,
      training_effect:  null,
      avg_cadence:      null,
      avg_speed_kmh:    speedKmh,
      tss:              null,
      avg_power:        null,
      max_power:        null,
      elevation_gain:   elevGain,
      normalized_power: null,
      ftp:              null,
    });
  }

  return {
    activities,
    wellness: Array.from(wellnessMap.values()),
  };
}
