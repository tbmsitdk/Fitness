/**
 * Travel & timezone logging.
 *
 * Logged per TRIP, not per day. A trip is a handful of fields entered once;
 * every per-day consequence (which days were away, when the body clock was
 * shifting, how far into adaptation a given day was) is derived. Asking for a
 * daily entry here would be friction with no extra information.
 *
 * The physiology this encodes:
 *
 * - DIRECTION DOMINATES. The human circadian period runs slightly longer than
 *   24 h, so delaying the clock (westward) is easier than advancing it
 *   (eastward). The same six zones are a materially harder trip east.
 * - ZONES ARE THE DOSE. Hours of displacement, not miles flown. A Copenhagen →
 *   Johannesburg flight is long-haul but costs almost no circadian shift.
 * - EFFECTS DECAY. Roughly a day per zone eastward, and about two thirds of
 *   that westward. Anything measured must be indexed on days since arrival.
 * - EVERY TRIP HAS TWO SHIFTS. Going out and coming home are separate circadian
 *   events in opposite directions, and the homebound one is routinely ignored.
 */

export interface TravelLog {
  id?: number;
  destination: string;
  /** Day you left home. */
  depart_date: string;
  /** Day you arrived at the destination (same day for most trips). */
  arrive_date: string;
  /** Day you were home again. Null while a trip is still open. */
  return_date: string | null;
  /** UTC offset in hours at home, e.g. 1 for Copenhagen winter. */
  home_utc_offset: number;
  /** UTC offset in hours at the destination. */
  dest_utc_offset: number;
  /** 'flight' | 'car' | 'train' | 'other' — travel strain independent of zones. */
  travel_mode: string | null;
  /** 'work' | 'leisure' — a strong confounder worth separating. */
  purpose: string | null;
  notes: string | null;
}

export const TRAVEL_MODES = ['flight', 'car', 'train', 'other'] as const;
export const TRAVEL_PURPOSES = ['work', 'leisure'] as const;

/**
 * Common destinations with their standard UTC offsets, so the form never asks
 * anyone to work out a number they will get wrong.
 *
 * NOTE: these are STANDARD offsets and ignore daylight saving. During summer a
 * given city may be an hour off this table. The error is at most one zone and
 * affects both endpoints similarly, so the DIFFERENCE — which is what the
 * analysis uses — is usually right. The form lets you override by hand.
 */
export const TIMEZONE_PRESETS: { label: string; offset: number }[] = [
  { label: 'Copenhagen / Oslo / Stockholm / Berlin / Paris', offset: 1 },
  { label: 'London / Lisbon / Dublin', offset: 0 },
  { label: 'Helsinki / Athens / Istanbul', offset: 2 },
  { label: 'Moscow / Nairobi', offset: 3 },
  { label: 'Dubai', offset: 4 },
  { label: 'Karachi / Islamabad', offset: 5 },
  { label: 'Delhi / Mumbai', offset: 5.5 },
  { label: 'Dhaka / Almaty', offset: 6 },
  { label: 'Bangkok / Jakarta / Hanoi', offset: 7 },
  { label: 'Singapore / Hong Kong / Beijing / Perth', offset: 8 },
  { label: 'Tokyo / Seoul', offset: 9 },
  { label: 'Sydney / Melbourne / Brisbane', offset: 10 },
  { label: 'Auckland', offset: 12 },
  { label: 'Azores / Cape Verde', offset: -1 },
  { label: 'Rio de Janeiro / Buenos Aires / São Paulo', offset: -3 },
  { label: 'New York / Toronto / Boston / Miami', offset: -5 },
  { label: 'Chicago / Mexico City', offset: -6 },
  { label: 'Denver / Calgary', offset: -7 },
  { label: 'Los Angeles / San Francisco / Vancouver / Seattle', offset: -8 },
  { label: 'Anchorage', offset: -9 },
  { label: 'Honolulu', offset: -10 },
];

/**
 * Actual UTC offset of an IANA zone ON A GIVEN DATE, daylight saving included.
 *
 * This is why the home base is stored as a zone name rather than a number.
 * Copenhagen is +1 in winter and +2 under CEST, so a fixed offset mis-states
 * every summer trip by an hour. For a European destination both ends shift
 * together and the difference survives, but Copenhagen → Tokyo in July is a
 * 7-hour shift, not the 8 a static table would claim.
 *
 * Falls back to null for an unrecognised zone rather than guessing — the caller
 * then keeps whatever offset was entered by hand.
 */
export function utcOffsetOn(ianaZone: string, dateStr: string): number | null {
  try {
    // Midday avoids landing on the DST transition hour itself.
    const at = new Date(`${dateStr}T12:00:00Z`);
    if (Number.isNaN(at.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: ianaZone, timeZoneName: 'longOffset',
    }).formatToParts(at);
    const name = parts.find(p => p.type === 'timeZoneName')?.value;   // e.g. "GMT+02:00"
    if (!name) return null;
    if (/^GMT$/.test(name)) return 0;
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
    if (!m) return null;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) + Number(m[3] ?? 0) / 60);
  } catch {
    return null;   // environment without full ICU data
  }
}

/** Home zones offered in Settings. Zone names, so DST resolves per date. */
export const HOME_TIMEZONES: { label: string; zone: string }[] = [
  { label: 'Copenhagen', zone: 'Europe/Copenhagen' },
  { label: 'Oslo', zone: 'Europe/Oslo' },
  { label: 'Stockholm', zone: 'Europe/Stockholm' },
  { label: 'Berlin', zone: 'Europe/Berlin' },
  { label: 'London', zone: 'Europe/London' },
  { label: 'Paris', zone: 'Europe/Paris' },
  { label: 'Amsterdam', zone: 'Europe/Amsterdam' },
  { label: 'Madrid', zone: 'Europe/Madrid' },
  { label: 'New York', zone: 'America/New_York' },
  { label: 'Los Angeles', zone: 'America/Los_Angeles' },
];

export type ShiftDirection = 'east' | 'west' | 'none';

/**
 * Signed timezone displacement. POSITIVE is eastward (clock advances, the hard
 * direction); negative is westward.
 *
 * Wraps across the dateline: Copenhagen (+1) to Auckland (+12) is 11 hours of
 * raw difference, but the body takes the short way round — 13 hours westward is
 * further than 11 eastward, so 11 east is correct here. Anything beyond 12 is
 * re-expressed as the shorter rotation in the other direction.
 */
export function zonesCrossed(fromOffset: number, toOffset: number): number {
  let diff = toOffset - fromOffset;
  while (diff > 12) diff -= 24;
  while (diff < -12) diff += 24;
  return diff;
}

export function shiftDirection(zones: number): ShiftDirection {
  if (zones > 0) return 'east';
  if (zones < 0) return 'west';
  return 'none';
}

/**
 * Days the body clock needs to resynchronise, by the standard clinical rule of
 * thumb: about one day per zone eastward, roughly two thirds of that westward.
 *
 * This is a population average and individuals vary widely — it is used to draw
 * an expected-adaptation window, never to assert that someone IS recovered.
 */
export function expectedAdaptationDays(zones: number): number {
  const magnitude = Math.abs(zones);
  if (magnitude === 0) return 0;
  return Math.round((zones > 0 ? magnitude : magnitude * 0.67) * 10) / 10;
}

/**
 * The two circadian events in a trip: arriving at the destination, and getting
 * home again. The homebound shift is the exact negative of the outbound one and
 * is routinely forgotten, which is why it is modelled explicitly.
 *
 * An open-ended trip (no return date yet) yields only the outbound event.
 */
export interface CircadianEvent {
  date: string;              // the day the shift happened
  zones: number;             // signed; + east
  direction: ShiftDirection;
  adaptationDays: number;
  leg: 'outbound' | 'homebound';
  destination: string;
  purpose: string | null;
}

export function circadianEvents(trip: TravelLog): CircadianEvent[] {
  const out = zonesCrossed(trip.home_utc_offset, trip.dest_utc_offset);
  const events: CircadianEvent[] = [{
    date: trip.arrive_date,
    zones: out,
    direction: shiftDirection(out),
    adaptationDays: expectedAdaptationDays(out),
    leg: 'outbound',
    destination: trip.destination,
    purpose: trip.purpose,
  }];

  if (trip.return_date) {
    const back = -out;
    events.push({
      date: trip.return_date,
      zones: back,
      direction: shiftDirection(back),
      adaptationDays: expectedAdaptationDays(back),
      leg: 'homebound',
      destination: 'Home',
      purpose: trip.purpose,
    });
  }
  return events;
}

const DAY_MS = 86_400_000;

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / DAY_MS
  );
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Every date from depart to return inclusive. Open trips run to `today`. */
export function tripDates(trip: TravelLog, today: string): string[] {
  const end = trip.return_date ?? today;
  const n = daysBetween(trip.depart_date, end);
  if (n < 0) return [];
  return Array.from({ length: n + 1 }, (_, i) => addDays(trip.depart_date, i));
}

/** Trip length in days, inclusive of both travel days. */
export function tripLength(trip: TravelLog, today: string): number {
  return tripDates(trip, today).length;
}

export function coerceTravelLog(row: Record<string, unknown>): TravelLog {
  const date = (v: unknown) =>
    v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  return {
    id: row.id != null ? Number(row.id) : undefined,
    destination: String(row.destination ?? ''),
    depart_date: date(row.depart_date) ?? '',
    arrive_date: date(row.arrive_date) ?? date(row.depart_date) ?? '',
    return_date: date(row.return_date),
    home_utc_offset: Number(row.home_utc_offset ?? 0),
    dest_utc_offset: Number(row.dest_utc_offset ?? 0),
    travel_mode: row.travel_mode != null ? String(row.travel_mode) : null,
    purpose: row.purpose != null ? String(row.purpose) : null,
    notes: row.notes != null ? String(row.notes) : null,
  };
}

/** Human summary for a trip, e.g. "Tokyo · 8 zones east · 9 days". */
export function describeTrip(trip: TravelLog, today: string): string {
  const z = zonesCrossed(trip.home_utc_offset, trip.dest_utc_offset);
  const dir = shiftDirection(z);
  const zonePart = dir === 'none'
    ? 'no timezone change'
    : `${Math.abs(z)} zone${Math.abs(z) === 1 ? '' : 's'} ${dir}`;
  return `${trip.destination} · ${zonePart} · ${tripLength(trip, today)} days`;
}
