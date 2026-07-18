// Age/sex-adjusted VO2max rating (ACSM/Cooper-style bands). Single source of
// truth — used by both the Longevity Score card and the AI coach context so
// they can never disagree about what a value means.

export interface Vo2Rating {
  category: 'Poor' | 'Fair' | 'Good' | 'Excellent' | 'Superior';
  score: number;       // 20/40/60/80/100 — used by LongevityScore weighting
  percentile: number;  // approximate population percentile for age/sex
}

// [fair, good, excellent, superior] lower bounds per age band
function bands(age: number, sex: 'male' | 'female'): [number, number, number, number] {
  if (sex === 'male') {
    if (age < 50) return [34, 38, 43, 48];
    if (age < 60) return [31, 35, 40, 45];
    return [28, 32, 36, 41];
  }
  if (age < 50) return [27, 31, 36, 41];
  return [25, 28, 32, 36];
}

export function vo2maxRating(vo2max: number, age: number, sex: 'male' | 'female'): Vo2Rating {
  const [fair, good, excellent, superior] = bands(age, sex);

  // Approximate percentile by linear interpolation between band edges
  // (fair≈20th, good≈45th, excellent≈75th, superior≈90th).
  const pct = (() => {
    const lerp = (x: number, x0: number, x1: number, y0: number, y1: number) =>
      y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    if (vo2max < fair)      return Math.max(5, lerp(vo2max, fair - 6, fair, 5, 20));
    if (vo2max < good)      return lerp(vo2max, fair, good, 20, 45);
    if (vo2max < excellent) return lerp(vo2max, good, excellent, 45, 75);
    if (vo2max < superior)  return lerp(vo2max, excellent, superior, 75, 90);
    return Math.min(99, lerp(vo2max, superior, superior + 6, 90, 99));
  })();
  const percentile = Math.round(pct);

  if (vo2max >= superior)  return { category: 'Superior',  score: 100, percentile };
  if (vo2max >= excellent) return { category: 'Excellent', score: 80,  percentile };
  if (vo2max >= good)      return { category: 'Good',      score: 60,  percentile };
  if (vo2max >= fair)      return { category: 'Fair',      score: 40,  percentile };
  return { category: 'Poor', score: 20, percentile };
}
