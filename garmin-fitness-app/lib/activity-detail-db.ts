// Reads the stored 10-second samples and turns them into activity-detail rows.
// Server-only. One query for all samples in the window, grouped in memory.

import { sql } from '@vercel/postgres';
import type { Activity } from '@/types';
import type { ActivitySample } from '@/lib/activity-analysis';
import { buildActivityDetailRows, MAX_SAMPLE_ACTIVITIES, pgIntArray, type ActivityDetailRow } from '@/lib/activity-detail';
import { daysAgo } from '@/lib/coach-data';

/** A year of samples is on the order of 100k rows; older than that stays out of memory. */
export const ACTIVITY_DETAIL_DAYS = 365;

export async function loadActivityDetail(
  activities: Activity[], today: string, ftp: number | null,
): Promise<ActivityDetailRow[]> {
  const cutoff = daysAgo(today, ACTIVITY_DETAIL_DAYS);
  const inWindow = activities.filter(a =>
    String(a.date).slice(0, 10) >= cutoff && ['running', 'cycling', 'walking'].includes(a.activity_type));
  if (inWindow.length === 0) return [];

  try {
    const { rows } = await sql`
      SELECT s.activity_id, s.elapsed_seconds, s.hr, s.power, s.cadence
      FROM activity_samples s
      JOIN activities a ON a.id = s.activity_id
      WHERE a.date >= ${cutoff} AND a.activity_type IN ('running', 'cycling', 'walking')
      ORDER BY s.activity_id, s.elapsed_seconds`;
    const by = new Map<number, ActivitySample[]>();
    for (const r of rows) {
      const id = Number(r.activity_id);
      const list = by.get(id) ?? [];
      list.push({
        elapsed_seconds: Number(r.elapsed_seconds),
        hr: r.hr != null ? Number(r.hr) : null,
        power: r.power != null ? Number(r.power) : null,
        cadence: r.cadence != null ? Number(r.cadence) : null,
      });
      by.set(id, list);
    }
    return buildActivityDetailRows(inWindow, by, ftp);
  } catch (e) {
    // The coach must still run without it.
    console.error('[activity-detail]', e);
    return [];
  }
}

export interface SampleActivity { id: number; start: string; type: string; title: string; rows: number }

/**
 * The activities whose raw samples go to a run: the newest `limit` that have samples.
 * `since` (a date) limits it to activities newer than the previous analysis; null looks back a year.
 */
export async function listSampleActivities(since: string | null, today: string, limit = MAX_SAMPLE_ACTIVITIES): Promise<SampleActivity[]> {
  const from = since ?? daysAgo(today, ACTIVITY_DETAIL_DAYS);
  try {
    const { rows } = await sql`
      SELECT a.id, a.date, a.activity_type, a.title, COUNT(*)::int AS n
      FROM activities a JOIN activity_samples s ON s.activity_id = a.id
      WHERE a.date >= ${from} AND a.activity_type IN ('running', 'cycling', 'walking')
      GROUP BY a.id, a.date, a.activity_type, a.title
      ORDER BY a.date DESC LIMIT ${limit}`;
    return rows.map(r => ({
      id: Number(r.id),
      start: r.date instanceof Date ? r.date.toISOString() : String(r.date),
      type: String(r.activity_type), title: String(r.title ?? ''), rows: Number(r.n),
    }));
  } catch (e) {
    console.error('[activity-detail] sample list', e);
    return [];
  }
}

/** One activity's samples, in time order. */
export async function loadSamplesFor(activityId: number): Promise<ActivitySample[]> {
  const { rows } = await sql`
    SELECT elapsed_seconds, hr, power, cadence FROM activity_samples
    WHERE activity_id = ${activityId} ORDER BY elapsed_seconds`;
  return rows.map(r => ({
    elapsed_seconds: Number(r.elapsed_seconds),
    hr: r.hr != null ? Number(r.hr) : null,
    power: r.power != null ? Number(r.power) : null,
    cadence: r.cadence != null ? Number(r.cadence) : null,
  }));
}

/**
 * Older activities with samples that no earlier run has read, newest first.
 * `exclude` holds ids already chosen for this run (the new ones).
 */
export async function listBackfillActivities(covered: number[], exclude: number[], limit: number): Promise<SampleActivity[]> {
  const skip = [...new Set([...covered, ...exclude])];
  try {
    const { rows } = await sql`
      SELECT a.id, a.date, a.activity_type, a.title, COUNT(*)::int AS n
      FROM activities a JOIN activity_samples s ON s.activity_id = a.id
      WHERE a.activity_type IN ('running', 'cycling', 'walking')
        AND NOT (a.id = ANY(${pgIntArray(skip)}::int[]))
      GROUP BY a.id, a.date, a.activity_type, a.title
      ORDER BY a.date DESC LIMIT ${limit}`;
    return rows.map(r => ({
      id: Number(r.id),
      start: r.date instanceof Date ? r.date.toISOString() : String(r.date),
      type: String(r.activity_type), title: String(r.title ?? ''), rows: Number(r.n),
    }));
  } catch (e) {
    console.error('[activity-detail] backfill list', e);
    return [];
  }
}
