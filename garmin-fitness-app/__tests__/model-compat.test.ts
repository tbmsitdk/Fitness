import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// BUG CLASS: request-shape and model-id defects that no unit test can catch,
// because they only fail against the live API. Both cost a production route.
//
//  1. `claude-sonnet-4-5` sat in training-plan long after deprecation; it
//     retires 2026-11-30 and the route would simply start erroring.
//  2. `tool_choice: {type:'tool'}` returns a 400 on Fable 5.2/5.1 and Sonnet
//     5.5 — the coach silently pinned the whole app to older models.
//
// See tasks/lessons.md.

const ROOTS = ['app', 'lib', 'components'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = ROOTS.flatMap(sourceFiles).map(f => ({ path: f, src: readFileSync(f, 'utf8') }));

/** Models that are deprecated, retired, or scheduled to retire. */
const RETIRED_MODELS: Record<string, string> = {
  'claude-sonnet-4-5': 'retires 2026-11-30 — use claude-sonnet-5-5',
  'claude-3-opus':     'retired — use claude-opus-5-5',
  'claude-3-sonnet':   'retired — use claude-sonnet-5-5',
  'claude-3-haiku':    'retired — use claude-haiku-5-5',
};

describe('model ids stay current', () => {
  it('names no deprecated or retired model', () => {
    const offenders: string[] = [];
    for (const { path, src } of FILES) {
      for (const [model, why] of Object.entries(RETIRED_MODELS)) {
        // Word-boundary-ish: allow a longer current id to contain a short one
        // (claude-sonnet-4-5-20251001 is still the deprecated model, so match
        // the prefix) but don't let claude-sonnet-5-5 trip claude-sonnet-4-5.
        if (src.includes(`'${model}`) || src.includes(`"${model}`)) {
          offenders.push(`${path}: ${model} (${why})`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

describe('request shapes stay compatible with current models', () => {
  it('never forces a tool call — 400s on Fable 5.2/5.1 and Sonnet 5.5', () => {
    // Forced tool_choice is `{type:'tool', name:...}` or `{type:'any'}`.
    // `auto` and `none` are fine.
    const forced = /tool_choice\s*:\s*\{\s*type\s*:\s*['"](tool|any)['"]/;
    const offenders = FILES
      .filter(f => forced.test(f.src))
      .map(f => `${f.path}: forced tool_choice — use {type:'auto'} plus a prompt instruction naming the tool`);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('never prefills the assistant turn — 400s on every current model', () => {
    // A trailing {role:'assistant'} in a messages array is a prefill.
    const offenders = FILES
      .filter(f => /messages\s*:\s*\[[^\]]*role\s*:\s*['"]assistant['"][^\]]*\]\s*,?\s*\}\s*\)/s.test(f.src)
                && !/anthropicMessages/.test(f.src))
      .map(f => `${f.path}: assistant prefill`);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

describe('the coach does not fail silently', () => {
  it('never falls back to an empty object when the model returns nothing usable', () => {
    const ai = readFileSync('lib/ai.ts', 'utf8');
    // The old code did `toolBlock?.input ?? {}`, which rendered a blank
    // coaching card as if it had succeeded.
    expect(ai).not.toMatch(/\?\.input\s*\?\?\s*\{\}/);
  });
});
