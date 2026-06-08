import { NextRequest, NextResponse } from 'next/server';
import { getActivitySamples } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const activityId = Number(id);
    if (!Number.isFinite(activityId)) {
      return NextResponse.json({ error: 'Invalid activity id' }, { status: 400 });
    }

    const samples = await getActivitySamples(activityId);
    return NextResponse.json({ samples });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
