import { describe, it, expect } from 'vitest';
import {
  zonesCrossed, shiftDirection, expectedAdaptationDays, circadianEvents, utcOffsetOn, HOME_TIMEZONES,
  tripDates, tripLength, daysBetween, addDays, coerceTravelLog, describeTrip,
  type TravelLog,
} from '@/lib/travel';
import {
  baselineBefore, recoveryCurve, tripImpact, tripImpacts, zoneCorrelation, travelKpis,
  travelEffect, pearson, significanceOf, CURVE_FROM, CURVE_TO,
} from '@/lib/travel-analysis';
import { OUTCOMES, type DayMetrics } from '@/lib/nutrition-analysis';

const HRV = OUTCOMES.find(o => o.key === 'hrv')!;
const TODAY = '2026-10-04';

function trip(o: Partial<TravelLog> = {}): TravelLog {
  return {
    destination: 'Tokyo',
    depart_date: '2026-09-01',
    arrive_date: '2026-09-02',
    return_date: '2026-09-10',
    home_utc_offset: 1,
    dest_utc_offset: 9,
    travel_mode: 'flight',
    purpose: 'work',
    notes: null,
    ...o,
  };
}

/** Flat HRV baseline, then an optional dip from a given date. */
function metricsWith(overrides: Record<string, number>, base = 50, from = '2026-08-01', days = 90) {
  const m = new Map<string, DayMetrics>();
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    m.set(d, { date: d, hrv: overrides[d] ?? base, restingHr: null, sleepHours: null,
               sleepScore: null, bodyBattery: null, stress: null, tss: null });
  }
  return m;
}

describe('zonesCrossed', () => {
  it('is positive eastward and negative westward', () => {
    expect(zonesCrossed(1, 9)).toBe(8);    // Copenhagen -> Tokyo
    expect(zonesCrossed(1, -5)).toBe(-6);  // Copenhagen -> New York
  });

  it('is zero for a north-south trip', () => {
    expect(zonesCrossed(1, 1)).toBe(0);    // Copenhagen -> Johannesburg
  });

  it('takes the short way round the dateline', () => {
    // Copenhagen (+1) -> Auckland (+12) is 11 east, not 13 west
    expect(zonesCrossed(1, 12)).toBe(11);
    // Tokyo (+9) -> Los Angeles (-8) is 17 raw, so 7 west is the real shift
    expect(zonesCrossed(9, -8)).toBe(-17 + 24);
  });

  it('handles half-hour zones', () => {
    expect(zonesCrossed(1, 5.5)).toBe(4.5); // Copenhagen -> Delhi
  });
});

describe('utcOffsetOn', () => {
  it('resolves Copenhagen to +1 in winter and +2 under summer time', () => {
    expect(utcOffsetOn('Europe/Copenhagen', '2026-01-15')).toBe(1);
    expect(utcOffsetOn('Europe/Copenhagen', '2026-07-15')).toBe(2);
  });

  it('is why a fixed offset is wrong: the same trip differs by a zone in July', () => {
    // Copenhagen -> Tokyo. Tokyo has no DST, so the shift shrinks in summer.
    const winter = zonesCrossed(utcOffsetOn('Europe/Copenhagen', '2026-01-15')!, 9);
    const summer = zonesCrossed(utcOffsetOn('Europe/Copenhagen', '2026-07-15')!, 9);
    expect(winter).toBe(8);
    expect(summer).toBe(7);
  });

  it('handles a zone with no DST and a negative offset', () => {
    expect(utcOffsetOn('Asia/Tokyo', '2026-07-15')).toBe(9);
    expect(utcOffsetOn('America/New_York', '2026-01-15')).toBe(-5);
    expect(utcOffsetOn('America/New_York', '2026-07-15')).toBe(-4);
  });

  it('handles UTC itself and half-hour zones', () => {
    expect(utcOffsetOn('UTC', '2026-01-15')).toBe(0);
    expect(utcOffsetOn('Asia/Kolkata', '2026-01-15')).toBe(5.5);
  });

  it('returns null for an unknown zone rather than guessing an offset', () => {
    expect(utcOffsetOn('Not/AZone', '2026-01-15')).toBeNull();
  });

  it('offers Copenhagen as a home base, and every listed zone resolves', () => {
    expect(HOME_TIMEZONES.some(t => t.zone === 'Europe/Copenhagen')).toBe(true);
    for (const t of HOME_TIMEZONES) {
      expect(utcOffsetOn(t.zone, '2026-01-15'), t.zone).not.toBeNull();
    }
  });
});

describe('shiftDirection', () => {
  it('labels each case', () => {
    expect(shiftDirection(3)).toBe('east');
    expect(shiftDirection(-3)).toBe('west');
    expect(shiftDirection(0)).toBe('none');
  });
});

describe('expectedAdaptationDays', () => {
  it('allows about a day per zone eastward', () => {
    expect(expectedAdaptationDays(8)).toBe(8);
  });

  it('allows less westward, because delaying the clock is easier', () => {
    expect(expectedAdaptationDays(-8)).toBeLessThan(expectedAdaptationDays(8));
    expect(expectedAdaptationDays(-8)).toBeCloseTo(5.4, 1);
  });

  it('is zero without a timezone change', () => {
    expect(expectedAdaptationDays(0)).toBe(0);
  });
});

describe('circadianEvents', () => {
  it('produces an outbound and a homebound shift in opposite directions', () => {
    const e = circadianEvents(trip());
    expect(e).toHaveLength(2);
    expect(e[0].leg).toBe('outbound');
    expect(e[0].zones).toBe(8);
    expect(e[0].direction).toBe('east');
    expect(e[1].leg).toBe('homebound');
    expect(e[1].zones).toBe(-8);
    expect(e[1].direction).toBe('west');
  });

  it('dates the outbound shift to arrival, not departure', () => {
    expect(circadianEvents(trip())[0].date).toBe('2026-09-02');
  });

  it('omits the homebound shift while a trip is still open', () => {
    expect(circadianEvents(trip({ return_date: null }))).toHaveLength(1);
  });
});

describe('tripDates / tripLength', () => {
  it('is inclusive of both travel days', () => {
    expect(tripLength(trip({ depart_date: '2026-09-01', return_date: '2026-09-03' }), TODAY)).toBe(3);
  });

  it('runs an open trip up to today', () => {
    const t = trip({ depart_date: addDays(TODAY, -2), return_date: null });
    expect(tripLength(t, TODAY)).toBe(3);
  });

  it('returns nothing for a return date before departure', () => {
    expect(tripDates(trip({ depart_date: '2026-09-10', return_date: '2026-09-01' }), TODAY)).toEqual([]);
  });
});

describe('date helpers', () => {
  it('counts days across a month boundary', () => {
    expect(daysBetween('2026-09-28', '2026-10-02')).toBe(4);
  });
  it('adds days across a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('coerceTravelLog', () => {
  it('converts DECIMAL offsets to numbers and dates to strings', () => {
    const t = coerceTravelLog({
      id: '2', destination: 'Delhi', depart_date: new Date('2026-09-01T00:00:00Z'),
      arrive_date: '2026-09-02', return_date: null,
      home_utc_offset: '1.00', dest_utc_offset: '5.50',
      travel_mode: 'flight', purpose: 'work', notes: null,
    });
    expect(t.home_utc_offset).toBe(1);
    expect(t.dest_utc_offset).toBe(5.5);
    expect(t.depart_date).toBe('2026-09-01');
    expect(t.return_date).toBeNull();
  });
});

describe('describeTrip', () => {
  it('summarises direction and magnitude', () => {
    expect(describeTrip(trip(), TODAY)).toContain('8 zones east');
  });
  it('says so when no zones are crossed', () => {
    expect(describeTrip(trip({ dest_utc_offset: 1 }), TODAY)).toContain('no timezone change');
  });
});

describe('baselineBefore', () => {
  it('averages the days before the event, not after', () => {
    // 60 before arrival, 40 after. Baseline must be 60.
    const m = metricsWith({}, 60);
    for (let i = 0; i <= 10; i++) {
      const d = addDays('2026-09-02', i);
      m.set(d, { ...m.get(d)!, hrv: 40 });
    }
    expect(baselineBefore('2026-09-02', m, HRV)).toBe(60);
  });

  it('refuses to invent a baseline from too few readings', () => {
    const m = new Map<string, DayMetrics>();
    m.set('2026-09-01', { date: '2026-09-01', hrv: 50, restingHr: null, sleepHours: null,
                          sleepScore: null, bodyBattery: null, stress: null, tss: null });
    expect(baselineBefore('2026-09-02', m, HRV)).toBeNull();
  });
});

describe('recoveryCurve', () => {
  it('shows a dip after arrival measured against the pre-trip baseline', () => {
    const dip: Record<string, number> = {};
    for (let i = 0; i <= 4; i++) dip[addDays('2026-09-02', i)] = 38;  // 12 below baseline
    const m = metricsWith(dip, 50);

    const c = recoveryCurve(circadianEvents(trip()), m, HRV, 'east');
    expect(c.trips).toBe(1);
    const arrival = c.points.find(p => p.offset === 0)!;
    expect(arrival.deviation).toBeCloseTo(-12, 5);
    const later = c.points.find(p => p.offset === 10)!;
    expect(later.deviation).toBeCloseTo(0, 5);
  });

  it('keeps east and west apart', () => {
    const m = metricsWith({}, 50);
    const events = circadianEvents(trip());
    expect(recoveryCurve(events, m, HRV, 'east').trips).toBe(1);
    expect(recoveryCurve(events, m, HRV, 'west').trips).toBe(1); // the homebound leg
  });

  it('spans the full charted window', () => {
    const c = recoveryCurve(circadianEvents(trip()), metricsWith({}, 50), HRV, 'east');
    expect(c.points[0].offset).toBe(CURVE_FROM);
    expect(c.points.at(-1)!.offset).toBe(CURVE_TO);
  });

  it('skips trips with no usable baseline rather than guessing', () => {
    const c = recoveryCurve(circadianEvents(trip()), new Map(), HRV, 'east');
    expect(c.trips).toBe(0);
  });
});

describe('tripImpact', () => {
  it('finds the worst drop and the day it happened', () => {
    const m = metricsWith({ '2026-09-04': 35 }, 50);
    const i = tripImpact(circadianEvents(trip())[0], m, HRV);
    expect(i.baseline).toBe(50);
    expect(i.worstDeviation).toBe(-15);
    expect(i.worstOffset).toBe(2);   // 2 days after arrival
  });

  it('reports recovery only when it holds for two days', () => {
    // Dips, touches baseline once on day 3, dips again — not recovered.
    const m = metricsWith({
      '2026-09-02': 40, '2026-09-03': 40, '2026-09-04': 40,
      '2026-09-05': 50, '2026-09-06': 40, '2026-09-07': 40,
    }, 50);
    const i = tripImpact(circadianEvents(trip())[0], m, HRV);
    expect(i.recoveredAfterDays).not.toBe(3);
  });

  it('stops the window at the next trip, so a later dip is not blamed on this one', () => {
    // Two eastward trips 6 days apart. The second one dips hard; the first must
    // not inherit that dip just because it falls inside a 14-day window.
    const first = circadianEvents(trip({ arrive_date: '2026-09-02', return_date: null }))[0];
    const second = circadianEvents(trip({ arrive_date: '2026-09-08', return_date: null }))[0];
    const m = metricsWith({ '2026-09-09': 20 }, 50);

    const contaminated = tripImpact(first, m, HRV);                  // no limit
    const truncated    = tripImpact(first, m, HRV, second.date);     // stops at the next shift

    expect(contaminated.worstDeviation).toBe(-30);  // wrongly picks up trip 2
    expect(truncated.worstDeviation).toBe(0);       // correctly sees nothing
  });

  it('returns nulls when no baseline exists', () => {
    const i = tripImpact(circadianEvents(trip())[0], new Map(), HRV);
    expect(i.baseline).toBeNull();
    expect(i.worstDeviation).toBeNull();
  });
});

describe('tripImpacts', () => {
  it('truncates every window against the following event automatically', () => {
    const trips = [
      trip({ arrive_date: '2026-09-02', return_date: null }),
      trip({ arrive_date: '2026-09-08', return_date: null }),
    ];
    const m = metricsWith({ '2026-09-09': 20 }, 50);
    const [a, b] = tripImpacts(trips.flatMap(circadianEvents), m, HRV);
    expect(a.worstDeviation).toBe(0);    // not contaminated by the later dip
    expect(b.worstDeviation).toBe(-30);  // which belongs to this trip
  });
});

describe('pearson', () => {
  it('is 1 for a perfect positive relationship', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
  });
  it('is -1 for a perfect inverse relationship', () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10);
  });
  it('is null without variance, since a constant correlates with nothing', () => {
    expect(pearson([5, 5, 5, 5], [1, 2, 3, 4])).toBeNull();
  });
  it('needs at least 3 pairs', () => {
    expect(pearson([1, 2], [2, 4])).toBeNull();
  });
});

describe('significanceOf', () => {
  it('calls a strong correlation on a decent sample likely real', () => {
    expect(significanceOf(0.9, 20)).toBe('likely real');
  });
  it('refuses to call a weak correlation anything', () => {
    expect(significanceOf(0.1, 20)).toBe('not distinguishable from chance');
  });
  it('is cautious on tiny samples even when r is high', () => {
    expect(significanceOf(0.8, 3)).toBe('not distinguishable from chance');
  });
  it('handles a null r', () => {
    expect(significanceOf(null, 20)).toBe('not distinguishable from chance');
  });
});

describe('zoneCorrelation', () => {
  it('reports damage per zone as a positive slope when more zones hurt more', () => {
    // Three eastward trips of 2, 5 and 9 zones with proportional HRV drops.
    const trips: TravelLog[] = [
      trip({ destination: 'A', dest_utc_offset: 3,  arrive_date: '2026-08-20', depart_date: '2026-08-20', return_date: null }),
      trip({ destination: 'B', dest_utc_offset: 6,  arrive_date: '2026-09-02', depart_date: '2026-09-02', return_date: null }),
      trip({ destination: 'C', dest_utc_offset: 10, arrive_date: '2026-09-20', depart_date: '2026-09-20', return_date: null }),
    ];
    const m = metricsWith({
      '2026-08-20': 48,   // 2 zones -> -2
      '2026-09-02': 45,   // 5 zones -> -5
      '2026-09-20': 41,   // 9 zones -> -9
    }, 50);

    const c = zoneCorrelation(trips.flatMap(circadianEvents), m, HRV, 'east');
    expect(c.n).toBe(3);
    expect(c.r!).toBeGreaterThan(0.95);
    expect(c.perZone!).toBeCloseTo(1, 1);   // ~1 ms of HRV per zone
  });

  it('is null with too few trips rather than reporting a two-point line', () => {
    const c = zoneCorrelation(circadianEvents(trip()), metricsWith({}, 50), HRV, 'east');
    expect(c.r).toBeNull();
  });
});

describe('travelKpis', () => {
  it('counts days away inclusively and reports the share of the period', () => {
    const k = travelKpis([trip({ depart_date: '2026-09-01', return_date: '2026-09-10' })],
                         '2026-09-01', '2026-09-30');
    expect(k.daysAway).toBe(10);
    expect(k.trips).toBe(1);
    expect(k.eastTrips).toBe(1);
    expect(k.westTrips).toBe(0);
  });

  it('totals the zones from both legs', () => {
    const k = travelKpis([trip()], '2026-09-01', '2026-09-30');
    expect(k.totalZonesCrossed).toBe(16);  // 8 out, 8 back
    expect(k.maxZones).toBe(8);
  });

  it('never counts a day away twice when trips overlap', () => {
    const k = travelKpis([
      trip({ depart_date: '2026-09-01', return_date: '2026-09-05' }),
      trip({ depart_date: '2026-09-03', return_date: '2026-09-07' }),
    ], '2026-09-01', '2026-09-30');
    expect(k.daysAway).toBe(7);  // 1st-7th, not 5+5
  });

  it('is all zeros with no trips', () => {
    const k = travelKpis([], '2026-09-01', '2026-09-30');
    expect(k.trips).toBe(0);
    expect(k.daysAway).toBe(0);
    expect(k.maxZones).toBe(0);
  });
});

describe('travelEffect', () => {
  it('averages the deviation across the adaptation window only', () => {
    const dip: Record<string, number> = {};
    for (let i = 0; i < 8; i++) dip[addDays('2026-09-02', i)] = 42;
    const m = metricsWith(dip, 50);
    const e = travelEffect(circadianEvents(trip()), m, HRV, 'east');
    expect(e.delta).toBeCloseTo(-8, 5);
    expect(e.n).toBe(8);   // 8 zones east -> 8-day window
  });

  it('returns null when nothing can be measured', () => {
    expect(travelEffect([], new Map(), HRV, 'east').delta).toBeNull();
  });
});
