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
  not_significant: ['Caffeine, n=90'], caveats: ['Observational.'], next_steps: ['Eat earlier'], charts: [], card_checks: [],
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
