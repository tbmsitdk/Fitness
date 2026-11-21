// What changed in the raw tables since a previous deep analysis, so the next run
// can build on that one and look only at the new or revised rows.
//
// Each row is fingerprinted (a short hash of its whole text). A row is "changed"
// when its fingerprint was not in the previous run's set: it is either new or was
// edited (a partial day completed, a meal corrected). A row that disappeared is
// "removed". Nothing here reads the values; the model reads the changed rows.

import { createHash } from 'crypto';

export type Fingerprints = Record<string, string[]>;

export interface TableChange {
  table: string;
  changed: number;
  removed: number;
  total: number;
  /** First and last date among the changed rows, when the first column is a date. */
  from: string | null;
  to: string | null;
}

export interface Delta {
  /** Header plus changed rows only, per table. Tables with no change are left out. */
  tables: Record<string, string>;
  summary: TableChange[];
  /** Changed plus removed rows over every table. */
  total: number;
}

/** Splits CSV text into records, keeping a newline inside quotes as part of its record. */
export function splitCsvRecords(csv: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') quoted = !quoted; // a doubled "" toggles twice, which nets out
    if (ch === '\n' && !quoted) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur !== '') out.push(cur);
  return out;
}

const hashRow = (row: string) => createHash('sha1').update(row).digest('hex').slice(0, 12);

export function fingerprintTables(tables: Record<string, string>): Fingerprints {
  const out: Fingerprints = {};
  for (const [name, csv] of Object.entries(tables)) {
    out[name] = splitCsvRecords(csv).slice(1).map(hashRow).sort();
  }
  return out;
}

const firstCell = (row: string) => row.split(',', 1)[0].replace(/^"|"$/g, '');
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Compares the current tables with the fingerprints a previous run saw. */
export function computeDelta(tables: Record<string, string>, baseline: Fingerprints): Delta {
  const outTables: Record<string, string> = {};
  const summary: TableChange[] = [];
  let total = 0;

  for (const name of new Set([...Object.keys(tables), ...Object.keys(baseline)])) {
    const csv = tables[name];
    const records = csv ? splitCsvRecords(csv) : [];
    const header = records[0] ?? '';
    const remaining = new Map<string, number>();
    for (const h of baseline[name] ?? []) remaining.set(h, (remaining.get(h) ?? 0) + 1);

    const changedRows: string[] = [];
    for (const row of records.slice(1)) {
      const h = hashRow(row);
      const left = remaining.get(h) ?? 0;
      if (left > 0) remaining.set(h, left - 1); else changedRows.push(row);
    }
    let removed = 0;
    for (const n of remaining.values()) removed += n;

    if (changedRows.length === 0 && removed === 0) continue;
    if (changedRows.length > 0) outTables[name] = [header, ...changedRows].join('\n');
    const dates = changedRows.map(firstCell).filter(isDate).sort();
    summary.push({
      table: name, changed: changedRows.length, removed,
      total: Math.max(0, records.length - 1),
      from: dates[0] ?? null, to: dates[dates.length - 1] ?? null,
    });
    total += changedRows.length + removed;
  }
  return { tables: outTables, summary, total };
}

/** One line per table, for the prompt. */
export function describeDelta(d: Delta): string {
  if (d.summary.length === 0) return 'No rows changed.';
  return d.summary.map(s => {
    const span = s.from ? (s.from === s.to ? ` (${s.from})` : ` (${s.from} to ${s.to})`) : '';
    return `- ${s.table}: ${s.changed} new or changed of ${s.total} rows${span}${s.removed ? `, ${s.removed} removed` : ''}`;
  }).join('\n');
}

/** Below this many changed rows a generic analysis cannot move; reuse the last one. */
export const MIN_CHANGED_ROWS = 3;
