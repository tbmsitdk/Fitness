import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase, upsertActivities, upsertWellness } from '@/lib/db';
import { parseGarminZip } from '@/lib/garmin-parser';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { blobUrl } = await request.json() as { blobUrl: string };

    if (!blobUrl || !blobUrl.startsWith('https://')) {
      return NextResponse.json({ error: 'Invalid blob URL' }, { status: 400 });
    }

    // Initialize DB tables if needed
    await initializeDatabase();

    // Download the ZIP from Vercel Blob
    const response = await fetch(blobUrl);
    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to download uploaded file' }, { status: 500 });
    }

    const buffer = await response.arrayBuffer();

    // Parse the ZIP
    const parsed = await parseGarminZip(buffer);

    // Wellness-only exports are valid — Garmin lets you export subsets.
    if (parsed.activities.length === 0 && parsed.wellness.length === 0) {
      return NextResponse.json({
        error: 'No activities or wellness data found in the export.',
        hint: 'Make sure you uploaded the full Garmin data export ZIP (it should contain *_summarizedActivities.json and/or UDS wellness files).',
      }, { status: 422 });
    }

    // Insert into Postgres
    const insertedActivities = await upsertActivities(parsed.activities);
    const insertedWellness = await upsertWellness(parsed.wellness);

    return NextResponse.json({
      success: true,
      activities_imported: insertedActivities,
      wellness_records_imported: insertedWellness,
      blob_url: blobUrl,
    });
  } catch (error) {
    console.error('Process error:', error);
    const msg = error instanceof Error ? error.message : 'Processing failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
