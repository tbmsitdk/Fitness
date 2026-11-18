import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

// GitHub Actions runs `run:` paths from the repo root. A second copy of a script at the root
// once ran instead of the real one, so a token regeneration "succeeded" with stale code.
const ROOT = resolve(__dirname, '..', '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

describe('workflow script paths', () => {
  it('has no scripts/ directory at the repo root to shadow the app copy', () => {
    expect(existsSync(join(ROOT, 'scripts'))).toBe(false);
  });

  it('every script or requirements file a workflow references exists', () => {
    const missing: string[] = [];
    for (const f of readdirSync(WORKFLOWS).filter(n => /\.ya?ml$/.test(n))) {
      const text = readFileSync(join(WORKFLOWS, f), 'utf8');
      // Steps with `working-directory: garmin-fitness-app` resolve relative to it; the rest from the root.
      const base = /working-directory:\s*garmin-fitness-app/.test(text);
      const refs = text.match(/(?:garmin-fitness-app\/)?scripts\/[\w./-]+\.(?:py|ts|txt|sh)/g) ?? [];
      for (const ref of refs) {
        const candidates = [join(ROOT, ref), ...(base ? [join(ROOT, 'garmin-fitness-app', ref)] : [])];
        if (!candidates.some(existsSync)) missing.push(`${f}: ${ref} does not exist`);
        if (!ref.startsWith('garmin-fitness-app/') && existsSync(join(ROOT, ref))) missing.push(`${f}: ${ref} resolves to a root copy`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('the regenerate workflow runs the script that stores tokens in the database', () => {
    const wf = readFileSync(join(WORKFLOWS, 'regenerate-garmin-tokens.yml'), 'utf8');
    const m = wf.match(/run:\s*python\s+(\S+garmin_regenerate_tokens\.py)/);
    expect(m).not.toBeNull();
    expect(readFileSync(join(ROOT, m![1]), 'utf8')).toContain('store_tokens');
  });
});
