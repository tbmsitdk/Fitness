import { describe, it, expect } from 'vitest';
import { readReply, parseCoachingReport, COACHING_REPORT_SCHEMA } from '@/lib/coach-report';

const good = JSON.stringify({
  summary: 'Fitness is trending up.',
  recommendations: ['TRAINING: ride 3x'],
  injury_risks: [],
  longevity_insights: ['VO2max 42'],
});

describe('readReply', () => {
  it('joins text blocks and collects the reasoning summary', () => {
    const r = readReply({
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: 'RHR fell 2 bpm.' },
        { type: 'text', text: '{"a":' },
        { type: 'text', text: '1}' },
      ],
    });
    expect(r.text).toBe('{"a":1}');
    expect(r.reasoning).toBe('RHR fell 2 bpm.');
  });

  it('ignores empty thinking blocks (display: omitted returns them blank)', () => {
    const r = readReply({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'x' }] });
    expect(r.reasoning).toBe('');
  });

  // BUG CLASS: a refusal or a cut-off arrives as HTTP 200. Reading content
  // without checking stop_reason renders an empty or half-written report as a
  // success.
  it('throws on a refusal instead of returning empty text', () => {
    expect(() => readReply({ stop_reason: 'refusal', content: [] })).toThrow(/declined/);
  });

  it('throws on a max_tokens cut-off instead of returning half a report', () => {
    expect(() => readReply({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"summary":"half' }] }))
      .toThrow(/max_tokens/);
  });
});

describe('parseCoachingReport', () => {
  it('parses a valid report', () => {
    const r = parseCoachingReport(good);
    expect(r.summary).toBe('Fitness is trending up.');
    expect(r.recommendations).toEqual(['TRAINING: ride 3x']);
    expect(r.injury_risks).toEqual([]);
  });

  it('throws on prose rather than rendering a blank card', () => {
    expect(() => parseCoachingReport('Here is your report: you are doing great')).toThrow(/not JSON/);
  });

  it('throws on a report with no summary', () => {
    expect(() => parseCoachingReport('{"summary":"  ","recommendations":[]}')).toThrow(/no summary/);
    expect(() => parseCoachingReport('{}')).toThrow(/no summary/);
  });

  it('drops non-string list items instead of rendering [object Object]', () => {
    const r = parseCoachingReport(JSON.stringify({ summary: 's', recommendations: ['a', 3, { x: 1 }, null] }));
    expect(r.recommendations).toEqual(['a']);
    expect(r.longevity_insights).toEqual([]);
  });
});

describe('COACHING_REPORT_SCHEMA', () => {
  it('meets the structured-output rules: closed object, every property required', () => {
    expect(COACHING_REPORT_SCHEMA.additionalProperties).toBe(false);
    expect([...COACHING_REPORT_SCHEMA.required].sort()).toEqual(Object.keys(COACHING_REPORT_SCHEMA.properties).sort());
  });
});
