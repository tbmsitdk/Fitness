export interface UserSettings {
  birthYear: number;
  sex: 'male' | 'female';
  weightKg: number | null;
  heightCm: number | null;
  maxHR: number | null;
  thresholdHR: number | null;
  dailyStepsGoal: number;
}

const STORAGE_KEY = 'fitness_user_settings';

export const DEFAULT_SETTINGS: UserSettings = {
  birthYear: new Date().getFullYear() - 45,
  sex: 'male',
  weightKg: null,
  heightCm: null,
  maxHR: null,
  thresholdHR: null,
  dailyStepsGoal: 10000,
};

export function getAge(s: UserSettings): number {
  return Math.max(20, Math.min(100, new Date().getFullYear() - s.birthYear));
}

export function getMaxHR(s: UserSettings): number {
  if (s.maxHR && s.maxHR > 100) return s.maxHR;
  return Math.max(150, 220 - getAge(s));
}

export function getThresholdHR(s: UserSettings): number {
  if (s.thresholdHR && s.thresholdHR > 80) return s.thresholdHR;
  return Math.round(getMaxHR(s) * 0.85);
}

export function getBMI(s: UserSettings): number | null {
  if (!s.weightKg || !s.heightCm) return null;
  return Math.round((s.weightKg / ((s.heightCm / 100) ** 2)) * 10) / 10;
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
