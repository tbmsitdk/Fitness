import JSZip from 'jszip';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import FitParser from 'fit-file-parser';
import type { ActivitySampleRow } from '@/lib/db';

const SAMPLE_INTERVAL_SECONDS = 10; // store one sample every 10s to keep storage lean

// ─── locate .fit files inside a Garmin export ZIP ──────────────────────────
// Files live under DI_CONNECT/DI-Connect-Fitness/ (or similar) and are named
// like "<activityId>_ACTIVITY.fit" — we match by the leading numeric ID.

export interface FitZipEntry {
  garminId: string;
  filePath: string;
}

export async function listFitFilesInZip(zip: JSZip): Promise<FitZipEntry[]> {
  const entries: FitZipEntry[] = [];
  for (const [filePath, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const nameLower = filePath.split('/').pop()?.toLowerCase() ?? '';
    if (filePath.includes('__MACOSX') || nameLower.startsWith('._')) continue;
    if (!nameLower.endsWith('.fit')) continue;

    const match = nameLower.match(/(\d{6,})/); // activity IDs are long numeric strings
    if (!match) continue;

    entries.push({ garminId: match[1], filePath });
  }
  return entries;
}

// ─── decode a single .fit buffer into down-sampled records ─────────────────

export async function parseFitSamples(buffer: Buffer | ArrayBuffer): Promise<ActivitySampleRow[]> {
  const fitParser = new FitParser({
    force: true,
    speedUnit: 'km/h',
    lengthUnit: 'km',
    temperatureUnit: 'celsius',
    elapsedRecordField: true,
    mode: 'list',
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await new Promise((resolve, reject) => {
    fitParser.parse(buffer as Buffer<ArrayBuffer>, (error: unknown, result: unknown) => {
      if (error) reject(error);
      else resolve(result);
    });
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const records: any[] = Array.isArray(data?.records) ? data.records : [];
  if (records.length === 0) return [];

  const out: ActivitySampleRow[] = [];
  let lastStored = -Infinity;

  for (const r of records) {
    const elapsed = Math.round(Number(r.elapsed_time ?? r.timer_time ?? 0));
    if (!isFinite(elapsed) || elapsed < 0) continue;
    if (elapsed - lastStored < SAMPLE_INTERVAL_SECONDS) continue;
    lastStored = elapsed;

    const hr = r.heart_rate != null ? Math.round(Number(r.heart_rate)) : null;
    const power = r.power != null ? Math.round(Number(r.power)) : null;
    const cadence = r.cadence != null ? Math.round(Number(r.cadence)) : null;

    if (hr == null && power == null && cadence == null) continue;

    out.push({ elapsed_seconds: elapsed, hr, power, cadence });
  }

  return out;
}
