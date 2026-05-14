import JSZip from 'jszip';
import Papa from 'papaparse';
import { ParsedGarminData } from '@/types';

function parseDuration(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parseInt(timeStr) || 0;
}

function parseFloat_(val: string | undefined): number | null {
  if (!val || val.trim() === '' || val.trim() === '--') return null;
  const n = parseFloat(val.replace(/,/g, '.'));
  return isNaN(n) ? null : n;
}

function parseInt_(val: string | undefined): number | null {
  if (!val || val.trim() === '' || val.trim() === '--') return null;
  const n = parseInt(val.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function normalizeActivityType(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('run')) return 'running';
  if (lower.includes('cycl') || lower.includes('bike') || lower.includes('ride')) return 'cycling';
  if (lower.includes('walk') || lower.includes('hike')) return 'walking';
  if (lower.includes('swim')) return 'swimming';
  if (lower.includes('strength') || lower.includes('gym') || lower.includes('yoga')) return 'strength';
  return lower;
}

function detectDistanceUnit(rows: Record<string, string>[]): 'km' | 'mi' {
  // Sample a few distances; if avg > 50 and activity is running it's probably miles
  const runRows = rows.filter(r => normalizeActivityType(r['Activity Type'] || '') === 'running');
  if (runRows.length === 0) return 'km';
  const avg = runRows.slice(0, 20).reduce((s, r) => {
    return s + (parseFloat_(r['Distance']) ?? 0);
  }, 0) / Math.min(runRows.length, 20);
  // Typical marathon = 42km, in miles ~26. If average running distance > 30, likely km.
  // Heuristic: if most values look like they're in miles (< 15 for a run), treat as miles
  return avg < 20 ? 'mi' : 'km';
}

function parseActivitiesCSV(csvContent: string): ParsedGarminData['activities'] {
  const result = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    skipEmptyLines: true,
    trimHeaders: true,
  });

  const rows = result.data;
  if (rows.length === 0) return [];

  const distUnit = detectDistanceUnit(rows);
  const kmFactor = distUnit === 'mi' ? 1.60934 : 1;

  return rows
    .filter(row => row['Activity ID'] && row['Date'])
    .map(row => {
      const distanceRaw = parseFloat_(row['Distance']) ?? 0;
      const distanceKm = distanceRaw * kmFactor;

      const speedRaw = parseFloat_(row['Avg Speed']);
      const avgSpeedKmh = speedRaw != null ? speedRaw * kmFactor : null;

      const elevGain = parseFloat_(row['Max Elevation']) != null && parseFloat_(row['Min Elevation']) != null
        ? Math.max(0, (parseFloat_(row['Max Elevation']) ?? 0) - (parseFloat_(row['Min Elevation']) ?? 0))
        : null;

      return {
        garmin_id: row['Activity ID'].trim(),
        activity_type: normalizeActivityType(row['Activity Type'] || 'other'),
        date: new Date(row['Date']).toISOString(),
        title: row['Title'] || '',
        distance_km: distanceKm,
        duration_seconds: parseDuration(row['Time'] || row['Moving Time'] || '0'),
        calories: parseInt_(row['Calories']) ?? 0,
        avg_hr: parseInt_(row['Avg HR']),
        max_hr: parseInt_(row['Max HR']),
        training_effect: parseFloat_(row['Aerobic TE']),
        avg_cadence: parseInt_(row['Avg Run Cadence'] || row['Avg Cadence']),
        avg_speed_kmh: avgSpeedKmh,
        tss: parseFloat_(row['Training Stress Score']),
        avg_power: parseInt_(row['Avg Power']),
        max_power: parseInt_(row['Max Power']),
        elevation_gain: elevGain,
      };
    })
    .filter(a => !isNaN(new Date(a.date).getTime()));
}

function parseDailyStepsCSV(csvContent: string): Map<string, Partial<ParsedGarminData['wellness'][0]>> {
  const map = new Map<string, Partial<ParsedGarminData['wellness'][0]>>();
  const result = Papa.parse<Record<string, string>>(csvContent, {
    header: true, skipEmptyLines: true, trimHeaders: true,
  });
  for (const row of result.data) {
    const dateKey = row['Date'] || row['date'] || row['Calendar Date'];
    if (!dateKey) continue;
    const dateStr = dateKey.split('T')[0];
    const steps = parseInt_(row['Steps'] || row['steps'] || row['Total Steps']);
    if (steps != null) {
      map.set(dateStr, { date: dateStr, steps });
    }
  }
  return map;
}

function parseRHRCSV(csvContent: string): Map<string, number> {
  const map = new Map<string, number>();
  const result = Papa.parse<Record<string, string>>(csvContent, {
    header: true, skipEmptyLines: true, trimHeaders: true,
  });
  for (const row of result.data) {
    const dateKey = Object.keys(row).find(k => k.toLowerCase().includes('date'));
    const hrKey = Object.keys(row).find(k => k.toLowerCase().includes('heart rate') || k.toLowerCase().includes('rhr') || k.toLowerCase().includes('bpm'));
    if (!dateKey || !hrKey) continue;
    const dateStr = (row[dateKey] || '').split('T')[0];
    const hr = parseInt_(row[hrKey]);
    if (dateStr && hr != null) map.set(dateStr, hr);
  }
  return map;
}

function parseHRVCSV(csvContent: string): Map<string, number> {
  const map = new Map<string, number>();
  const result = Papa.parse<Record<string, string>>(csvContent, {
    header: true, skipEmptyLines: true, trimHeaders: true,
  });
  for (const row of result.data) {
    const dateKey = Object.keys(row).find(k => k.toLowerCase().includes('date'));
    const hrvKey = Object.keys(row).find(k => k.toLowerCase().includes('hrv') || k.toLowerCase().includes('rmssd'));
    if (!dateKey || !hrvKey) continue;
    const dateStr = (row[dateKey] || '').split('T')[0];
    const hrv = parseFloat_(row[hrvKey]);
    if (dateStr && hrv != null) map.set(dateStr, hrv);
  }
  return map;
}

function parseSleepCSV(csvContent: string): Map<string, { hours: number; score: number | null }> {
  const map = new Map<string, { hours: number; score: number | null }>();
  const result = Papa.parse<Record<string, string>>(csvContent, {
    header: true, skipEmptyLines: true, trimHeaders: true,
  });
  for (const row of result.data) {
    const dateKey = Object.keys(row).find(k => k.toLowerCase().includes('date'));
    if (!dateKey) continue;
    const dateStr = (row[dateKey] || '').split('T')[0];
    const hoursKey = Object.keys(row).find(k => k.toLowerCase().includes('total sleep') || k.toLowerCase().includes('duration'));
    const scoreKey = Object.keys(row).find(k => k.toLowerCase().includes('score'));
    if (!dateStr || !hoursKey) continue;
    const rawVal = row[hoursKey];
    let hours: number | null = null;
    if (rawVal && rawVal.includes(':')) {
      hours = parseDuration(rawVal) / 3600;
    } else {
      hours = parseFloat_(rawVal);
    }
    if (hours != null) {
      map.set(dateStr, { hours, score: parseInt_(scoreKey ? row[scoreKey] : undefined) });
    }
  }
  return map;
}

function parseStressCSV(csvContent: string): Map<string, number> {
  const map = new Map<string, number>();
  const result = Papa.parse<Record<string, string>>(csvContent, {
    header: true, skipEmptyLines: true, trimHeaders: true,
  });
  for (const row of result.data) {
    const dateKey = Object.keys(row).find(k => k.toLowerCase().includes('date'));
    const stressKey = Object.keys(row).find(k => k.toLowerCase().includes('stress') && k.toLowerCase().includes('avg'));
    if (!dateKey || !stressKey) continue;
    const dateStr = (row[dateKey] || '').split('T')[0];
    const stress = parseInt_(row[stressKey]);
    if (dateStr && stress != null) map.set(dateStr, stress);
  }
  return map;
}

export async function parseGarminZip(buffer: ArrayBuffer): Promise<ParsedGarminData> {
  const zip = await JSZip.loadAsync(buffer);

  let activitiesCSV: string | null = null;
  const wellnessFiles: Record<string, string> = {};

  for (const [filePath, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const lower = filePath.toLowerCase();
    const name = path.split('/').pop()?.toLowerCase() || '';

    if (name === 'activities.csv') {
      activitiesCSV = await file.async('string');
    } else if (name.startsWith('dailysteps') || name === 'daily_steps.csv') {
      wellnessFiles['steps'] = await file.async('string');
    } else if (name.startsWith('rhr_export') || name === 'rhr.csv') {
      wellnessFiles['rhr'] = await file.async('string');
    } else if (name.startsWith('hrv_export') || name === 'hrv.csv') {
      wellnessFiles['hrv'] = await file.async('string');
    } else if (name.startsWith('sleep') && name.endsWith('.csv')) {
      wellnessFiles['sleep'] = await file.async('string');
    } else if (name.startsWith('stress') && name.endsWith('.csv')) {
      wellnessFiles['stress'] = await file.async('string');
    } else if (lower.includes('/di_connect/') && name.endsWith('.csv')) {
      // Attempt to identify by content later
      if (lower.includes('step') && !wellnessFiles['steps']) {
        wellnessFiles['steps'] = await file.async('string');
      } else if (lower.includes('rhr') && !wellnessFiles['rhr']) {
        wellnessFiles['rhr'] = await file.async('string');
      } else if (lower.includes('hrv') && !wellnessFiles['hrv']) {
        wellnessFiles['hrv'] = await file.async('string');
      } else if (lower.includes('sleep') && !wellnessFiles['sleep']) {
        wellnessFiles['sleep'] = await file.async('string');
      } else if (lower.includes('stress') && !wellnessFiles['stress']) {
        wellnessFiles['stress'] = await file.async('string');
      }
    }
  }

  const activities = activitiesCSV ? parseActivitiesCSV(activitiesCSV) : [];

  // Merge wellness data by date
  const wellnessMap = new Map<string, ParsedGarminData['wellness'][0]>();

  if (wellnessFiles['steps']) {
    for (const [date, data] of parseDailyStepsCSV(wellnessFiles['steps'])) {
      wellnessMap.set(date, { date, steps: data.steps ?? null, resting_hr: null, hrv_rmssd: null, sleep_hours: null, sleep_score: null, stress_score: null, body_battery: null });
    }
  }

  if (wellnessFiles['rhr']) {
    for (const [date, hr] of parseRHRCSV(wellnessFiles['rhr'])) {
      const existing = wellnessMap.get(date) ?? { date, steps: null, resting_hr: null, hrv_rmssd: null, sleep_hours: null, sleep_score: null, stress_score: null, body_battery: null };
      wellnessMap.set(date, { ...existing, resting_hr: hr });
    }
  }

  if (wellnessFiles['hrv']) {
    for (const [date, hrv] of parseHRVCSV(wellnessFiles['hrv'])) {
      const existing = wellnessMap.get(date) ?? { date, steps: null, resting_hr: null, hrv_rmssd: null, sleep_hours: null, sleep_score: null, stress_score: null, body_battery: null };
      wellnessMap.set(date, { ...existing, hrv_rmssd: hrv });
    }
  }

  if (wellnessFiles['sleep']) {
    for (const [date, s] of parseSleepCSV(wellnessFiles['sleep'])) {
      const existing = wellnessMap.get(date) ?? { date, steps: null, resting_hr: null, hrv_rmssd: null, sleep_hours: null, sleep_score: null, stress_score: null, body_battery: null };
      wellnessMap.set(date, { ...existing, sleep_hours: s.hours, sleep_score: s.score });
    }
  }

  if (wellnessFiles['stress']) {
    for (const [date, stress] of parseStressCSV(wellnessFiles['stress'])) {
      const existing = wellnessMap.get(date) ?? { date, steps: null, resting_hr: null, hrv_rmssd: null, sleep_hours: null, sleep_score: null, stress_score: null, body_battery: null };
      wellnessMap.set(date, { ...existing, stress_score: stress });
    }
  }

  return {
    activities,
    wellness: Array.from(wellnessMap.values()),
  };
}
