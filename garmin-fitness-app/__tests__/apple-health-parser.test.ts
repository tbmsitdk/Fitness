import { describe, it, expect } from 'vitest';
import { busiestSourceTotal, parseXML } from '@/lib/apple-health-parser';

const step = (source: string | null, day: string, hhmm: string, value: number, type = 'HKQuantityTypeIdentifierStepCount') =>
  `<Record type="${type}" ${source ? `sourceName="${source}" ` : ''}unit="count" creationDate="${day} ${hhmm}:00 +0100" ` +
  `startDate="${day} ${hhmm}:00 +0100" endDate="${day} ${hhmm}:30 +0100" value="${value}"/>`;

const parse = (...records: string[]) => parseXML(`<HealthData>\n${records.join('\n')}\n</HealthData>`);
const day = (out: ReturnType<typeof parse>, d: string) => out.wellness.find(w => w.date === d)!;

describe('Apple Health steps across sources', () => {
  // The real defect: the 1-year average read 10,762 while Garmin's own figure was 8,030,
  // because every source's records for the same walk were added together.
  it('does not add the same steps up once per source', () => {
    const out = parse(
      step('iPhone', '2026-01-10', '08:00', 3000), step('iPhone', '2026-01-10', '17:00', 3000),
      step('Apple Watch', '2026-01-10', '08:00', 2500), step('Apple Watch', '2026-01-10', '17:00', 2700),
      step('Garmin Connect', '2026-01-10', '12:00', 5900),
    );
    expect(day(out, '2026-01-10').steps).toBe(6000);   // the iPhone, not 17,100
  });

  it('still totals a single source across the day', () => {
    const out = parse(step('iPhone', '2026-01-11', '08:00', 1200), step('iPhone', '2026-01-11', '12:00', 3400), step('iPhone', '2026-01-11', '18:00', 800));
    expect(day(out, '2026-01-11').steps).toBe(5400);
  });

  it('resolves each day on its own, and can pick a different source on different days', () => {
    const out = parse(
      step('iPhone', '2026-01-12', '09:00', 4000), step('Apple Watch', '2026-01-12', '09:00', 3000),
      step('iPhone', '2026-01-13', '09:00', 2000), step('Apple Watch', '2026-01-13', '09:00', 7000),
    );
    expect(day(out, '2026-01-12').steps).toBe(4000);
    expect(day(out, '2026-01-13').steps).toBe(7000);
  });

  it('treats records with no source name as one source, as before', () => {
    const out = parse(step(null, '2026-01-14', '08:00', 1000), step(null, '2026-01-14', '10:00', 2000));
    expect(day(out, '2026-01-14').steps).toBe(3000);
  });

  it('applies the same rule to flights climbed', () => {
    const f = 'HKQuantityTypeIdentifierFlightsClimbed';
    const out = parse(step('iPhone', '2026-01-15', '08:00', 12, f), step('Apple Watch', '2026-01-15', '08:00', 11, f), step('iPhone', '2026-01-15', '15:00', 6, f));
    expect(day(out, '2026-01-15').flights_climbed).toBe(18);   // iPhone 12 + 6, not 29
  });

  it('files a record under the day it started', () => {
    const out = parse(step('iPhone', '2026-01-16', '23:50', 900));
    expect(out.wellness.map(w => w.date)).toEqual(['2026-01-16']);
  });
});

describe('busiestSourceTotal', () => {
  it('returns the largest single source, and null for none', () => {
    expect(busiestSourceTotal(new Map([['a', 10], ['b', 25], ['c', 7]]))).toBe(25);
    expect(busiestSourceTotal(new Map())).toBeNull();
    expect(busiestSourceTotal(new Map([['a', NaN], ['b', 4]]))).toBe(4);
  });
});
