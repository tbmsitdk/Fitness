import { describe, it, expect } from 'vitest';
import { busiestSourceTotal, parseXML } from '@/lib/apple-health-parser';

const IPHONE = "Marc's iPhone";
const GARMIN = 'Connect';

/** One Health record: source, local day, start and end time (HH:MM). */
const rec = (source: string | null, day: string, from: string, to: string, value: number, type = 'HKQuantityTypeIdentifierStepCount') =>
  `<Record type="${type}" ${source ? `sourceName="${source}" ` : ''}unit="count" creationDate="${day} ${from}:00 +0100" ` +
  `startDate="${day} ${from}:00 +0100" endDate="${day} ${to}:00 +0100" value="${value}"/>`;

const parse = (...records: string[]) => parseXML(`<HealthData>\n${records.join('\n')}\n</HealthData>`);
const day = (out: ReturnType<typeof parse>, d: string) => out.wellness.find(w => w.date === d)!;

describe('Apple Health steps: Garmin first, the iPhone only where Garmin recorded nothing', () => {
  // The real defect: the 1-year average read 10,762 while Garmin's own figure was 8,030,
  // because every source's records for the same walk were added together.
  it('does not add the iPhone on top of Garmin', () => {
    const out = parse(
      rec(GARMIN, '2026-01-10', '08:00', '08:15', 3000), rec(IPHONE, '2026-01-10', '08:00', '08:15', 3300),
      rec(GARMIN, '2026-01-10', '17:00', '17:15', 3000), rec(IPHONE, '2026-01-10', '17:00', '17:15', 3200),
    );
    const w = day(out, '2026-01-10');
    expect(w.steps).toBe(6000);             // Garmin's, not 12,500
    expect(w.steps_fill).toBe(0);
    expect(w.steps_fill_ref).toBe(6000);
    expect(w.steps_source).toBe('apple');
  });

  it('fills the stretch Garmin was charging from the iPhone', () => {
    const out = parse(
      rec(GARMIN, '2026-01-11', '08:00', '08:15', 2000), rec(GARMIN, '2026-01-11', '18:00', '18:15', 3000),
      rec(IPHONE, '2026-01-11', '12:00', '12:15', 700), rec(IPHONE, '2026-01-11', '13:00', '13:15', 500),
    );
    const w = day(out, '2026-01-11');
    expect(w.steps).toBe(6200);
    expect(w.steps_fill).toBe(1200);
    expect(w.steps_fill_ref).toBe(5000);
  });

  it('uses the iPhone alone on a day with no Garmin records, with no fill to add later', () => {
    const out = parse(rec(IPHONE, '2026-01-12', '09:00', '09:15', 4000), rec(IPHONE, '2026-01-12', '15:00', '15:15', 1000));
    const w = day(out, '2026-01-12');
    expect(w.steps).toBe(5000);
    expect(w.steps_fill).toBeNull();
    expect(w.steps_fill_ref).toBeNull();
  });

  it('ignores an Apple Watch and records with no source name', () => {
    const out = parse(rec("Marc's Apple Watch", '2026-01-13', '09:00', '09:15', 4000), rec(null, '2026-01-13', '10:00', '10:15', 1000));
    expect(day(out, '2026-01-13').steps).toBeNull();
  });

  it('resolves each day on its own', () => {
    const out = parse(
      rec(GARMIN, '2026-01-14', '09:00', '09:15', 4000), rec(IPHONE, '2026-01-14', '09:00', '09:15', 9000),
      rec(IPHONE, '2026-01-15', '09:00', '09:15', 3000),
    );
    expect(day(out, '2026-01-14').steps).toBe(4000);
    expect(day(out, '2026-01-15').steps).toBe(3000);
  });

  it('files a record under the day it started, even if it runs past midnight', () => {
    const out = parse(`<Record type="HKQuantityTypeIdentifierStepCount" sourceName="${IPHONE}" unit="count" startDate="2026-01-16 23:50:00 +0100" endDate="2026-01-17 00:10:00 +0100" value="400"/>`);
    expect(out.wellness.map(w => w.date)).toEqual(['2026-01-16']);
    expect(day(out, '2026-01-16').steps).toBe(400);
  });
});

describe('flights climbed across sources', () => {
  it('takes the busiest source rather than the sum', () => {
    const f = 'HKQuantityTypeIdentifierFlightsClimbed';
    const out = parse(
      rec(IPHONE, '2026-01-15', '08:00', '08:05', 12, f), rec("Marc's Apple Watch", '2026-01-15', '08:00', '08:05', 11, f),
      rec(IPHONE, '2026-01-15', '15:00', '15:05', 6, f),
    );
    expect(day(out, '2026-01-15').flights_climbed).toBe(18);   // iPhone 12 + 6, not 29
  });
});

describe('busiestSourceTotal', () => {
  it('returns the largest single source, and null for none', () => {
    expect(busiestSourceTotal(new Map([['a', 10], ['b', 25], ['c', 7]]))).toBe(25);
    expect(busiestSourceTotal(new Map())).toBeNull();
    expect(busiestSourceTotal(new Map([['a', NaN], ['b', 4]]))).toBe(4);
  });
});
