import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import {
  initializeDatabase,
  getActivityIdMap,
  getActivityIdsWithSamples,
  insertActivitySamples,
} from '@/lib/db';
import { listFitFilesInZip, parseFitSamples } from '@/lib/fit-parser';

export const maxDuration = 300; // resumable — clamps to plan limit (e.g. 60s on Hobby)
export const dynamic = 'force-dynamic';

const SOFT_DEADLINE_MS = 50_000; // leave headroom under maxDuration before returning

// Resumable backfill: each call downloads the export ZIP, finds .fit files whose
// activity doesn't have samples yet, decodes + stores as many as possible within
// a soft time budget, and reports how many remain so the client can call again.
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const { blobUrl } = await request.json() as { blobUrl: string };
    if (!blobUrl || !blobUrl.startsWith('https://')) {
      return NextResponse.json({ error: 'Invalid blob URL' }, { status: 400 });
    }

    await initializeDatabase();

    const response = await fetch(blobUrl);
    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to download uploaded file' }, { status: 500 });
    }
    const buffer = await response.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    const fitEntries = await listFitFilesInZip(zip);
    const idMap = await getActivityIdMap();
    const alreadyDone = await getActivityIdsWithSamples();

    // Filter to entries that map to a known activity and aren't done yet
    const pending = fitEntries.filter(e => {
      const activityId = idMap.get(e.garminId);
      return activityId != null && !alreadyDone.has(activityId);
    });

    let processed = 0;
    let failed = 0;

    for (const entry of pending) {
      if (Date.now() - startedAt > SOFT_DEADLINE_MS) break;

      const activityId = idMap.get(entry.garminId)!;
      try {
        const file = zip.files[entry.filePath];
        const fitBuffer = await file.async('nodebuffer');
        const samples = await parseFitSamples(fitBuffer);
        if (samples.length > 0) {
          await insertActivitySamples(activityId, samples);
        }
        processed++;
      } catch (err) {
        failed++;
        console.error(`[process-samples] failed for garmin_id=${entry.garminId}:`, err);
      }
    }

    const remaining = pending.length - processed - failed;

    return NextResponse.json({
      success: true,
      total_fit_files: fitEntries.length,
      already_done: alreadyDone.size,
      processed,
      failed,
      remaining: Math.max(remaining, 0),
      done: remaining <= 0,
    });
  } catch (error) {
    console.error('Process-samples error:', error);
    const msg = error instanceof Error ? error.message : 'Processing failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
