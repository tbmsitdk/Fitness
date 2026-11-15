import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { askStructured } from '@/lib/ai';
import { coerceNutritionLog } from '@/lib/nutrition';
import {
  MAX_BACKDATE_DAYS, MAX_IMAGES, MAX_TEXT_LENGTH, QUICK_LOG_SCHEMA, QUICK_LOG_SYSTEM,
  buildQuickLogPrompt, resolveQuickLog,
} from '@/lib/quick-log';
import { homeDayAndTime } from '@/lib/raw-data';
import { daysAgo } from '@/lib/coach-data';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageType = typeof IMAGE_TYPES[number];
/** ~2.2 MB of image per photo once decoded; the client downsizes well below this. */
const MAX_IMAGE_BASE64 = 3_000_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// POST /api/quick-log { text?, images?: [{ mediaType, data }] }
//
// Reads the note and returns a PROPOSAL. Nothing is saved here: the client
// shows the proposal and, on confirmation, posts each part to the ordinary
// /api/nutrition, /api/exercises and /api/travel routes, which validate again.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { text?: unknown; images?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT_LENGTH) : '';

    const images: { mediaType: ImageType; data: string }[] = [];
    for (const img of Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : []) {
      const { mediaType, data } = (img ?? {}) as { mediaType?: unknown; data?: unknown };
      if (!IMAGE_TYPES.includes(mediaType as ImageType) || typeof data !== 'string') {
        return NextResponse.json({ error: 'Photos must be JPEG, PNG, GIF or WebP.' }, { status: 400 });
      }
      if (data.length > MAX_IMAGE_BASE64 || !/^[A-Za-z0-9+/]+=*$/.test(data)) {
        return NextResponse.json({ error: 'That photo is too large or unreadable.' }, { status: 400 });
      }
      images.push({ mediaType: mediaType as ImageType, data });
    }
    if (!text && images.length === 0) {
      return NextResponse.json({ error: 'Write a note or add a photo.' }, { status: 400 });
    }

    const today = homeDayAndTime(new Date().toISOString()).day;
    const { rows } = await sql`
      SELECT id, date::text, alcohol_units, candy_portions, savoury_snacks, sugary_drinks,
             to_char(last_food_time, 'HH24:MI') AS last_food_time,
             caffeine_after_14, meal_quality, notes
      FROM nutrition_logs WHERE date >= ${daysAgo(today, MAX_BACKDATE_DAYS)} ORDER BY date
    `;
    const existing = rows.map(coerceNutritionLog);

    const reply = await askStructured({
      system: QUICK_LOG_SYSTEM,
      schema: QUICK_LOG_SCHEMA,
      effort: 'low',
      images,
      prompt: buildQuickLogPrompt({
        text, today,
        weekday: WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()],
        recentLogs: existing.filter(l => l.date.slice(0, 10) >= daysAgo(today, 3)),
        hasImages: images.length > 0,
      }),
    });

    return NextResponse.json({ proposal: resolveQuickLog(reply.text, existing, today) });
  } catch (e) {
    console.error('[quick-log] POST', e);
    return NextResponse.json({ error: 'Could not read that note. Try again, or use the forms.' }, { status: 500 });
  }
}
