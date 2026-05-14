export interface Activity {
  id: number;
  garmin_id: string;
  activity_type: string;
  date: string;
  title: string;
  distance_km: number;
  duration_seconds: number;
  calories: number;
  avg_hr: number | null;
  max_hr: number | null;
  training_effect: number | null;
  avg_cadence: number | null;
  avg_speed_kmh: number | null;
  tss: number | null;
  avg_power: number | null;
  max_power: number | null;
  elevation_gain: number | null;
}

export interface WellnessRecord {
  id: number;
  date: string;
  steps: number | null;
  resting_hr: number | null;
  hrv_rmssd: number | null;
  sleep_hours: number | null;
  sleep_score: number | null;
  stress_score: number | null;
  body_battery: number | null;
}

export interface WeeklyVolume {
  week: string;
  running_km: number;
  cycling_km: number;
  walking_km: number;
  running_hours: number;
  cycling_hours: number;
  walking_hours: number;
  total_tss: number;
}

export interface TrainingLoad {
  date: string;
  ctl: number;
  atl: number;
  tsb: number;
  daily_tss: number;
}

export interface HRZoneData {
  zone: string;
  minutes: number;
  percentage: number;
}

export interface PersonalBest {
  label: string;
  value: string;
  date: string;
  activity_type: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AISummary {
  summary: string;
  recommendations: string[];
  injury_risks: string[];
  longevity_insights: string[];
  generated_at: string;
cached?: boolean;
}

export interface ParsedGarminData {
  activities: Omit<Activity, 'id'>[];
  wellness: Omit<WellnessRecord, 'id'>[];
}

export type SportType = 'running' | 'cycling' | 'walking' | 'other';

export interface ConsistencyData {
  month: string;
  active_days: number;
  total_days: number;
  running_days: number;
  cycling_days: number;
  walking_days: number;
}
