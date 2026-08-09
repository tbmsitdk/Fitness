export interface UserSettings {
  birthYear: number;
  birthDate: string | null;  // YYYY-MM-DD — more accurate than year-only
  sex: 'male' | 'female';
  heightCm: number | null;
  maxHR: number | null;
  thresholdHR: number | null;
  garminFtp: number | null;  // auto-synced from Garmin biometric profile (set by Zwift FTP tests)
  dailyStepsGoal: number;
  minCyclingPower: number | null;  // rides averaging below this (W) are excluded from power KPIs
}

const STORAGE_KEY = 'fitness_user_settings';

export const DEFAULT_SETTINGS: UserSettings = {
  birthYear: new Date().getFullYear() - 45,
  birthDate: null,
  sex: 'male',
  heightCm: null,
  maxHR: null,
  thresholdHR: null,
  garminFtp: null,
  dailyStepsGoal: 10000,
  minCyclingPower: null,
};

// Age as of a specific date rather than today — used to build historical
// time series (e.g. cardiovascular age over time) where each past point
// should use the age the person actually was on that date.
export function getAgeAsOf(s: UserSettings, asOf: Date): number {
  if (s.birthDate) {
    const birth = new Date(s.birthDate);
    let age = asOf.getFullYear() - birth.getFullYear();
    const m = asOf.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && asOf.getDate() < birth.getDate())) age--;
    return Math.max(10, Math.min(110, age));
  }
  return Math.max(20, Math.min(100, asOf.getFullYear() - s.birthYear));
}

export function getAge(s: UserSettings): number {
  return getAgeAsOf(s, new Date());
}

export function getMaxHR(s: UserSettings): number {
  if (s.maxHR && s.maxHR > 100) return s.maxHR;
  return Math.max(150, 220 - getAge(s));
}

export function getThresholdHR(s: UserSettings): number {
  if (s.thresholdHR && s.thresholdHR > 80) return s.thresholdHR;
  return Math.round(getMaxHR(s) * 0.85);
}

export function getBMI(weightKg: number | null, heightCm: number | null): number | null {
  if (!weightKg || !heightCm) return null;
  return Math.round((weightKg / ((heightCm / 100) ** 2)) * 10) / 10;
}

export function loadSettings(): UserSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch { return DEFAULT_SETTINGS; }
}

export function saveSettings(s: UserSettings): void {
  if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}
