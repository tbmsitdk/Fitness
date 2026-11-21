// Reads the stored 10-second samples and turns them into activity-detail rows.
// Server-only. One query for all samples in the window, grouped in memory.

import { sql } from '@vercel/postgres';
import type { Activity } from '@/types';
import type { ActivitySample } from '@/lib/activity-analysis';
import { buildActivityDetailRows, type ActivityDetailRow } from '@/lib/activity-detail';
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
