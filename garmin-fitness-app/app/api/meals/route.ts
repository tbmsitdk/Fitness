import { NextRequest, NextResponse } from 'next/server';
import { cleanMeal, isMealType } from '@/lib/meals';
import { addToDay, deleteMeal, getDay, rescaleMeal, setDayComplete, setMealType, updateMeal } from '@/lib/meals-db';
import { homeDayAndTime } from '@/lib/raw-data';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };
const MAX_MEALS_PER_REQUEST = 12;

/** A real calendar day, not in the future, at most a year back. */
function validDay(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T12:00:00Z`))) return false;
  const today = homeDayAndTime(new Date().toISOString()).day;
  const yearAgo = new Date(`${today}T12:00:00Z`); yearAgo.setUTCDate(yearAgo.getUTCDate() - 366);
  return v <= today && v >= yearAgo.toISOString().slice(0, 10);
}

// GET /api/meals?date=YYYY-MM-DD → that day's diary
export async function GET(req: NextRequest) {
  try {
    const date = req.nextUrl.searchParams.get('date');
    if (!validDay(date)) return NextResponse.json({ error: 'Valid date required' }, { status: 400 });
    return NextResponse.json(await getDay(date), { headers: NO_STORE });
  } catch (e) {
    console.error('[meals] GET', e);
    return NextResponse.json({ error: 'Could not load the diary' }, { status: 500 });
  }
}

// POST /api/meals { date, meals: [...], no_alcohol?, complete? } → add to a day
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (!validDay(body.date)) return NextResponse.json({ error: 'Valid date required' }, { status: 400 });
    const date = body.date;
    const raw = Array.isArray(body.meals) ? body.meals.slice(0, MAX_MEALS_PER_REQUEST) : [];
    const meals = raw.map(m => cleanMeal(m, date)).filter((m): m is NonNullable<typeof m> => m !== null)
      // Statements are created here from the flag below, never taken from the client as meals.
      .map(m => ({ ...m, no_alcohol_statement: false }));
    const noAlcohol = body.no_alcohol === true;
    const complete = typeof body.complete === 'boolean' ? body.complete : undefined;
    if (meals.length === 0 && !noAlcohol && complete === undefined) {
      return NextResponse.json({ error: 'Nothing to add' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...(await addToDay(date, meals, { noAlcohol, complete })) }, { headers: NO_STORE });
  } catch (e) {
    console.error('[meals] POST', e);
    return NextResponse.json({ error: 'Could not save the meal' }, { status: 500 });
  }
}

// PATCH /api/meals { date, complete }   → mark the day complete or not
// PATCH /api/meals { id, factor }       → rescale one meal's portion
// PATCH /api/meals { id, meal_type }    → breakfast | lunch | dinner | in_between | null
// PATCH /api/meals { id, meal: {...} }  → correct an entry's description, time and amounts
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.complete === 'boolean') {
      if (!validDay(body.date)) return NextResponse.json({ error: 'Valid date required' }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await setDayComplete(body.date, body.complete)) }, { headers: NO_STORE });
    }
    const id = Number(body.id);
    if (body.meal && typeof body.meal === 'object') {
      if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id is required' }, { status: 400 });
      const ok = await updateMeal(id, body.meal);
      return ok
        ? NextResponse.json({ ok }, { headers: NO_STORE })
        : NextResponse.json({ error: 'That entry could not be changed. It needs a description.' }, { status: 400 });
    }
    if ('meal_type' in body) {
      if (!Number.isInteger(id) || id <= 0 || !(body.meal_type === null || isMealType(body.meal_type))) {
        return NextResponse.json({ error: 'id and a valid meal_type are required' }, { status: 400 });
      }
      return NextResponse.json({ ok: await setMealType(id, body.meal_type) }, { headers: NO_STORE });
    }
    const factor = Number(body.factor);
    if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(factor) || factor < 0.1 || factor > 5) {
      return NextResponse.json({ error: 'id and a factor between 0.1 and 5 are required' }, { status: 400 });
    }
    return NextResponse.json({ ok: await rescaleMeal(id, factor) }, { headers: NO_STORE });
  } catch (e) {
    console.error('[meals] PATCH', e);
    return NextResponse.json({ error: 'Could not update the diary' }, { status: 500 });
  }
}

// DELETE /api/meals?id=12
export async function DELETE(req: NextRequest) {
  try {
    const id = Number(req.nextUrl.searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    return NextResponse.json({ ok: await deleteMeal(id) }, { headers: NO_STORE });
  } catch (e) {
    console.error('[meals] DELETE', e);
    return NextResponse.json({ error: 'Could not delete the meal' }, { status: 500 });
  }
}
