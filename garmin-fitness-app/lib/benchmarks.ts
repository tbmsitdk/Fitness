/**
 * Age-adjusted peer benchmarks for an active recreational male athlete.
 * Benchmarks are based on published sports-science literature and Garmin
 * population data for trained, non-elite adults.
 *
 * BIRTHDATE drives automatic bracket selection — no manual updates needed.
 * On the user's next birthday the correct bracket is picked automatically.
 */

const BIRTHDATE = new Date('1969-07-10');

export function getAge(): number {
  const today = new Date();
  let age = today.getFullYear() - BIRTHDATE.getFullYear();
  const m = today.getMonth() - BIRTHDATE.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < BIRTHDATE.getDate())) age--;
  return age;
}

export type AgeBracket = {
  label: string;         // e.g. "55–59"
  hrv: number;           // resting RMSSD (ms) — peer average
  rhr: number;           // resting HR (bpm) — peer average
  sleep: number;         // sleep hours — recommended
  ctlMin: number;        // CTL lower end of trained-amateur range
  ctlMax: number;        // CTL upper end of trained-amateur range
  weeklyKm: number;      // total weekly distance km — peer average
  weeklyHours: number;   // total weekly training hours — peer average
  stepsAvg: number;      // daily steps — peer average
};

const BRACKETS: (AgeBracket & { minAge: number; maxAge: number })[] = [
  { minAge: 40, maxAge: 44, label: '40–44', hrv: 45, rhr: 55, sleep: 7.5, ctlMin: 55, ctlMax: 75, weeklyKm: 70, weeklyHours: 6.0, stepsAvg: 8500 },
  { minAge: 45, maxAge: 49, label: '45–49', hrv: 42, rhr: 57, sleep: 7.3, ctlMin: 50, ctlMax: 70, weeklyKm: 65, weeklyHours: 5.5, stepsAvg: 8200 },
  { minAge: 50, maxAge: 54, label: '50–54', hrv: 38, rhr: 58, sleep: 7.2, ctlMin: 45, ctlMax: 65, weeklyKm: 60, weeklyHours: 5.0, stepsAvg: 8000 },
  { minAge: 55, maxAge: 59, label: '55–59', hrv: 35, rhr: 60, sleep: 7.0, ctlMin: 40, ctlMax: 60, weeklyKm: 55, weeklyHours: 4.5, stepsAvg: 7800 },
  { minAge: 60, maxAge: 64, label: '60–64', hrv: 32, rhr: 62, sleep: 7.0, ctlMin: 35, ctlMax: 55, weeklyKm: 50, weeklyHours: 4.0, stepsAvg: 7500 },
  { minAge: 65, maxAge: 69, label: '65–69', hrv: 29, rhr: 64, sleep: 6.8, ctlMin: 30, ctlMax: 50, weeklyKm: 45, weeklyHours: 3.5, stepsAvg: 7200 },
  { minAge: 70, maxAge: 99, label: '70+',   hrv: 26, rhr: 66, sleep: 6.5, ctlMin: 25, ctlMax: 45, weeklyKm: 38, weeklyHours: 3.0, stepsAvg: 7000 },
];

/** Returns the benchmark values for the user's current age bracket. */
export function getPeerBenchmarks(): AgeBracket & { age: number } {
  const age = getAge();
  const bracket =
    BRACKETS.find(b => age >= b.minAge && age <= b.maxAge) ??
    BRACKETS[BRACKETS.length - 1];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { minAge, maxAge, ...rest } = bracket;
  return { ...rest, age };
}
