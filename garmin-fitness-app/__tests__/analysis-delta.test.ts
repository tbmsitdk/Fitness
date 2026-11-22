import { describe, it, expect } from 'vitest';
import { computeDelta, describeDelta, fingerprintTables, splitCsvRecords, MIN_CHANGED_ROWS } from '@/lib/analysis-delta';
import { buildAnalysisPrompt, parseAnalysisResult, reuseUnchanged, summariseForUpdate, type AnalysisResult } from '@/lib/analysis';

const wellness1 = 'date,resting_hr,sleep_hours\n2026-11-10,52,7.1\n2026-11-11,53,6.5\n2026-11-12,51,7.4';
const run = (t: string) => ({ 'wellness.csv': t });

describe('computeDelta', () => {
  const base = fingerprintTables(run(wellness1));

  it('finds nothing when nothing changed', () => {
    const d = computeDelta(run(wellness1), base);
    expect(d.total).toBe(0);
    expect(d.summary).toEqual([]);
    expect(d.tables).toEqual({});
  });

  it('returns only the new rows, with the header, and their date span', () => {
    const d = computeDelta(run(`${wellness1}\n2026-11-13,50,8.0\n2026-11-14,52,7.0`), base);
    expect(d.total).toBe(2);
    expect(d.tables['wellness.csv']).toBe('date,resting_hr,sleep_hours\n2026-11-13,50,8.0\n2026-11-14,52,7.0');
    expect(d.summary[0]).toMatchObject({ table: 'wellness.csv', changed: 2, removed: 0, total: 5, from: '2026-11-13', to: '2026-11-14' });
  });

  it('treats an edited row as changed, and counts the old version as removed', () => {
    const d = computeDelta(run(wellness1.replace('6.5', '7.0')), base);
    expect(d.tables['wellness.csv']).toContain('2026-11-11,53,7.0');
    expect(d.tables['wellness.csv']).not.toContain('2026-11-10');
    expect(d.summary[0]).toMatchObject({ changed: 1, removed: 1 });
  });

  it('counts a removed row', () => {
    const d = computeDelta(run('date,resting_hr,sleep_hours\n2026-11-10,52,7.1\n2026-11-11,53,6.5'), base);
    expect(d.summary[0]).toMatchObject({ changed: 0, removed: 1 });
    expect(d.tables['wellness.csv']).toBeUndefined();
  });

  it('treats a whole new table as changed, and does not lose duplicate identical rows', () => {
    const dup = 'date,x\n2026-11-10,1\n2026-11-10,1';
    const d1 = computeDelta({ 'meals.csv': dup }, {});
    expect(d1.summary[0]).toMatchObject({ table: 'meals.csv', changed: 2 });
    const d2 = computeDelta({ 'meals.csv': dup }, fingerprintTables({ 'meals.csv': 'date,x\n2026-11-10,1' }));
    expect(d2.summary[0]).toMatchObject({ changed: 1 });
  });

  it('keeps a quoted newline inside its record', () => {
    const csv = 'date,note\n2026-11-10,"line one\nline two"\n2026-11-11,plain';
    expect(splitCsvRecords(csv)).toHaveLength(3);
    expect(fingerprintTables({ 't.csv': csv })['t.csv']).toHaveLength(2);
  });

  it('describes the change per table', () => {
    const d = computeDelta(run(`${wellness1}\n2026-11-13,50,8.0`), base);
    expect(describeDelta(d)).toContain('wellness.csv: 1 new or changed of 4 rows (2026-11-13)');
    expect(describeDelta(computeDelta(run(wellness1), base))).toBe('No rows changed.');
  });
});

const prev: AnalysisResult = {
  headline: 'Late meals cost sleep.',
  findings: [{ title: 'Late meals', detail: 'About 20 min less deep sleep.', evidence: 'r=-0.3, 95% CI -0.5 to -0.1', n: 120, confidence: 'medium' }],
  not_significant: ['Caffeine, n=90'], caveats: ['Observational.'], next_steps: ['Eat earlier'], charts: [], card_checks: [], activity_notes: [],
};

describe('building on the previous run', () => {
  it('carries the last result forward, marked unchanged, when too little changed', () => {
    const r = reuseUnchanged(prev, '2026-11-01', 1);
    expect(MIN_CHANGED_ROWS).toBeGreaterThan(1);
    expect(r.headline).toContain('Only 1 row changed since the analysis of 2026-11-01');
    expect(r.findings[0].status).toBe('unchanged');
    expect(r.caveats[0]).toContain('not re-run');
    expect(reuseUnchanged(prev, '2026-11-01', 0).headline).toContain('No data has changed');
  });

  it('puts the earlier findings and only-the-changes instruction in the prompt', () => {
    const p = buildAnalysisPrompt({
      kind: 'deep', question: null, files: ['wellness.csv', 'changes_wellness.csv'], aggregates: '{}', today: '2026-11-21',
      update: { previousDate: '2026-11-01', previousRunId: 7, previous: summariseForUpdate(prev), changes: '- wellness.csv: 2 new', changeFiles: ['changes_wellness.csv'] },
    });
    expect(p).toContain('UPDATE of the analysis from 2026-11-01');
    expect(p).toContain('Late meals [medium, n=120]');
    expect(p).toContain('Do NOT re-explore history');
    expect(p).toContain('changes_wellness.csv');
  });

  it('is not used for a question run, or any other kind', () => {
    const update = { previousDate: 'd', previousRunId: 1, previous: 'p', changes: 'c', changeFiles: [] };
    expect(buildAnalysisPrompt({ kind: 'deep', question: 'Why?', files: [], aggregates: '{}', today: 't', update })).not.toContain('UPDATE of the analysis');
    expect(buildAnalysisPrompt({ kind: 'monthly', question: null, files: [], aggregates: '{}', today: 't', update })).not.toContain('UPDATE of the analysis');
  });

  it('reads a finding status, and calls an old or unknown one new', () => {
    const r = parseAnalysisResult(JSON.stringify({ headline: 'h', findings: [
      { title: 'a', detail: 'd', evidence: 'e', n: 5, confidence: 'low', status: 'reversed' },
      { title: 'b', detail: 'd', evidence: 'e', n: 5, confidence: 'low' },
      { title: 'c', detail: 'd', evidence: 'e', n: 5, confidence: 'low', status: 'banana' },
    ] }));
    expect(r.findings.map(f => f.status)).toEqual(['reversed', 'new', 'new']);
  });
});

import { chooseSampleActivities, MAX_SAMPLE_ACTIVITIES } from '@/lib/activity-detail';
import { BACKFILL_PER_RUN } from '@/lib/analysis';

const act = (id: number) => ({ id, start: `2026-11-${String(id % 28 + 1).padStart(2, '0')}T08:00:00Z`, type: 'cycling', title: `Ride ${id}`, rows: 300 });

describe('reading a little of the history every run', () => {
  it('starts with 3 older activities per run', () => {
    expect(BACKFILL_PER_RUN).toBe(3);
  });

  it('puts every new activity first (capped) and then at most 3 older ones, marked as such', () => {
    const fresh = Array.from({ length: 40 }, (_, i) => act(i + 1));
    const older = [act(101), act(102), act(103), act(104), act(105)];
    const out = chooseSampleActivities(fresh, older, undefined, BACKFILL_PER_RUN);
    expect(out.filter(a => !a.backfill)).toHaveLength(MAX_SAMPLE_ACTIVITIES);
    expect(out.filter(a => a.backfill).map(a => a.id)).toEqual([101, 102, 103]);
    expect(out.findIndex(a => a.backfill)).toBe(MAX_SAMPLE_ACTIVITIES);
  });

  it('never reads the same activity twice in one run', () => {
    const out = chooseSampleActivities([act(1), act(2)], [act(2), act(3)], undefined, 3);
    expect(out.map(a => a.id)).toEqual([1, 2, 3]);
    expect(out.find(a => a.id === 2)!.backfill).toBe(false);
  });

  it('reads no older activities for a question run', () => {
    expect(chooseSampleActivities([act(1)], [act(2)], undefined, 0).map(a => a.id)).toEqual([1]);
  });

  it('asks for one note per activity read, and shows earlier notes as leads', () => {
    const p = buildAnalysisPrompt({
      kind: 'deep', question: null, files: ['activity_samples.csv'], aggregates: '{}', today: '2026-11-22',
      samplesRead: [{ id: 7, start: '2026-11-20T08:00:00Z', type: 'cycling', title: 'Zwift', backfill: false },
                    { id: 3, start: '2025-02-02T08:00:00Z', type: 'running', title: 'Long run', backfill: true }],
      priorNotes: '- 2026-11-01 cycling: Three 8-minute blocks, HR climbed 6 bpm.',
    });
    expect(p).toContain('activity_id 7');
    expect(p).toContain('(older, read for the first time)');
    expect(p).toContain('add one activity_notes entry');
    expect(p).toContain('leads to test, not facts');
    expect(p).toContain('Three 8-minute blocks');
  });

  it('asks for no notes on a question run', () => {
    const p = buildAnalysisPrompt({
      kind: 'deep', question: 'Why?', files: [], aggregates: '{}', today: 't',
      samplesRead: [{ id: 7, start: '2026-11-20T08:00:00Z', type: 'cycling', title: 'Zwift', backfill: false }],
    });
    expect(p).not.toContain('activity_notes entry');
  });

  it('parses notes, drops unusable ones and caps their length; old results have none', () => {
    const r = parseAnalysisResult(JSON.stringify({ headline: 'h', activity_notes: [
      { activity_id: 7, note: `  Steady   ride.  ${'x'.repeat(400)}` },
      { activity_id: 0, note: 'bad id' }, { activity_id: 8, note: '   ' }, { note: 'no id' }, 'junk',
    ] }));
    expect(r.activity_notes).toHaveLength(1);
    expect(r.activity_notes[0].activity_id).toBe(7);
    expect(r.activity_notes[0].note.length).toBeLessThanOrEqual(240);
    expect(r.activity_notes[0].note.startsWith('Steady ride.')).toBe(true);
    expect(parseAnalysisResult(JSON.stringify({ headline: 'h' })).activity_notes).toEqual([]);
  });

  it('a carried-forward result writes no new notes', () => {
    expect(reuseUnchanged({ ...prev, activity_notes: [{ activity_id: 1, note: 'n' }] }, '2026-11-01', 0).activity_notes).toEqual([]);
  });
});
