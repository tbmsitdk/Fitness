import { describe, it, expect } from 'vitest';
import {
  MAX_MEMORY_FILES, MAX_MEMORY_FILE_CHARS, adviceNote, createInMemoryStore, memoryPromptSection,
  normaliseMemoryPath, runMemoryCommand, staleAdviceFiles,
} from '@/lib/coach-memory';

describe('normaliseMemoryPath', () => {
  it('accepts plain paths under /memories', () => {
    expect(normaliseMemoryPath('/memories/notes.md')).toBe('/memories/notes.md');
    expect(normaliseMemoryPath('/memories/advice/2026-11-15-weekly.md')).toBe('/memories/advice/2026-11-15-weekly.md');
    expect(normaliseMemoryPath('/memories/')).toBe('/memories');
  });

  // The model chooses these paths. Nothing outside the one namespace, ever.
  it('rejects traversal, other roots and odd characters', () => {
    for (const bad of [
      '/memories/../etc/passwd', '/memories/a/../../b', '/etc/passwd', 'memories/x.md', '/memoriesX/x.md',
      '/memories//x.md', '/memories/./x.md', '/memories/.hidden', '/memories/a b.md', "/memories/x';DROP TABLE.md",
      '/memories/%2e%2e/x', '', null, 42, `/memories/${'a'.repeat(300)}`,
    ]) {
      expect(normaliseMemoryPath(bad), String(bad)).toBeNull();
    }
  });
});

describe('runMemoryCommand', () => {
  it('creates, views, edits, inserts, renames and deletes a file', async () => {
    const store = createInMemoryStore();
    expect(await runMemoryCommand(store, { command: 'create', path: '/memories/notes.md', file_text: 'line one\nline two' })).toMatch(/Saved/);
    expect(await runMemoryCommand(store, { command: 'view', path: '/memories/notes.md' })).toContain('   2\tline two');
    expect(await runMemoryCommand(store, { command: 'str_replace', path: '/memories/notes.md', old_str: 'two', new_str: '2' })).toMatch(/Edited/);
    expect(await runMemoryCommand(store, { command: 'insert', path: '/memories/notes.md', insert_line: 1, insert_text: 'middle' })).toMatch(/Inserted/);
    expect((await store.get('/memories/notes.md'))!.content).toBe('line one\nmiddle\nline 2');
    expect(await runMemoryCommand(store, { command: 'rename', old_path: '/memories/notes.md', new_path: '/memories/log.md' })).toMatch(/Renamed/);
    expect(await store.get('/memories/notes.md')).toBeNull();
    expect(await runMemoryCommand(store, { command: 'delete', path: '/memories/log.md' })).toMatch(/Deleted/);
    expect(await store.list()).toEqual([]);
  });

  it('lists the directory', async () => {
    const store = createInMemoryStore({ '/memories/a.md': 'x', '/memories/advice/b.md': 'y' });
    const root = await runMemoryCommand(store, { command: 'view', path: '/memories' });
    expect(root).toContain('/memories/a.md');
    expect(root).toContain('/memories/advice/b.md');
    const sub = await runMemoryCommand(store, { command: 'view', path: '/memories/advice' });
    expect(sub).toContain('/memories/advice/b.md');
    expect(sub).not.toContain('/memories/a.md');
    expect(await runMemoryCommand(createInMemoryStore(), { command: 'view', path: '/memories' })).toMatch(/empty/);
  });

  it('honours a view range', async () => {
    const store = createInMemoryStore({ '/memories/a.md': 'l1\nl2\nl3\nl4' });
    const out = await runMemoryCommand(store, { command: 'view', path: '/memories/a.md', view_range: [2, 3] });
    expect(out).toBe('   2\tl2\n   3\tl3');
  });

  it('answers bad input with an error string instead of throwing or writing', async () => {
    const store = createInMemoryStore({ '/memories/a.md': 'same same' });
    expect(await runMemoryCommand(store, { command: 'create', path: '/etc/passwd', file_text: 'x' })).toMatch(/^Error/);
    expect(await runMemoryCommand(store, { command: 'create', path: '/memories', file_text: 'x' })).toMatch(/^Error/);
    expect(await runMemoryCommand(store, { command: 'view', path: '/memories/missing.md' })).toMatch(/does not exist/);
    expect(await runMemoryCommand(store, { command: 'str_replace', path: '/memories/a.md', old_str: 'nope', new_str: 'x' })).toMatch(/not found/);
    expect(await runMemoryCommand(store, { command: 'str_replace', path: '/memories/a.md', old_str: 'same', new_str: 'x' })).toMatch(/2 times/);
    expect(await runMemoryCommand(store, { command: 'insert', path: '/memories/a.md', insert_line: 99, insert_text: 'x' })).toMatch(/^Error/);
    expect(await runMemoryCommand(store, { command: 'rename', old_path: '/memories/a.md', new_path: '/memories/a.md' })).toMatch(/already exists/);
    expect(await runMemoryCommand(store, { command: 'delete', path: '/memories/missing.md' })).toMatch(/does not exist/);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await runMemoryCommand(store, { command: 'format_disk' } as any)).toMatch(/unknown/);
    expect((await store.get('/memories/a.md'))!.content).toBe('same same');
  });

  it('cannot delete the whole memory in one call', async () => {
    const store = createInMemoryStore({ '/memories/a.md': 'x' });
    expect(await runMemoryCommand(store, { command: 'delete', path: '/memories' })).toMatch(/^Error/);
    expect(await store.list()).toHaveLength(1);
  });

  it('enforces the size and count limits', async () => {
    const store = createInMemoryStore();
    expect(await runMemoryCommand(store, { command: 'create', path: '/memories/big.md', file_text: 'x'.repeat(MAX_MEMORY_FILE_CHARS + 1) })).toMatch(/limit/);
    for (let i = 0; i < MAX_MEMORY_FILES; i++) await store.put(`/memories/f${i}.md`, 'x');
    expect(await runMemoryCommand(store, { command: 'create', path: '/memories/one-more.md', file_text: 'x' })).toMatch(/limit/);
    // Overwriting an existing file is still allowed at the limit.
    expect(await runMemoryCommand(store, { command: 'create', path: '/memories/f0.md', file_text: 'y' })).toMatch(/Saved/);
    await store.put('/memories/grow.md', 'x'.repeat(MAX_MEMORY_FILE_CHARS - 1));
    expect(await runMemoryCommand(store, { command: 'insert', path: '/memories/grow.md', insert_line: 0, insert_text: 'too much' })).toMatch(/longer than/);
  });

  it('treats $ in a replacement literally', async () => {
    const store = createInMemoryStore({ '/memories/a.md': 'cost: X' });
    await runMemoryCommand(store, { command: 'str_replace', path: '/memories/a.md', old_str: 'X', new_str: '$& $1 $$' });
    expect((await store.get('/memories/a.md'))!.content).toBe('cost: $& $1 $$');
  });
});

describe('memoryPromptSection', () => {
  it('says so when the memory is empty', () => {
    expect(memoryPromptSection([])).toMatch(/nothing has been saved yet/);
  });

  it('shows the newest notes first and reports what it left out', () => {
    const files = [
      { path: '/memories/old.md', content: 'o'.repeat(600), updated_at: '2026-01-01T00:00:00Z' },
      { path: '/memories/new.md', content: 'n'.repeat(600), updated_at: '2026-11-01T00:00:00Z' },
    ];
    const s = memoryPromptSection(files, 700);
    expect(s).toContain('/memories/new.md');
    expect(s).not.toContain('/memories/old.md');
    expect(s).toMatch(/1 older file not shown/);
  });
});

describe('advice log', () => {
  it('writes a dated, bounded note under /memories/advice', () => {
    const note = adviceNote('weekly', '2026-11-15', 'Solid week.', ['TRAINING: ride   3x\nthis week', ...Array(20).fill('x')]);
    expect(note.path).toBe('/memories/advice/2026-11-15-weekly.md');
    expect(normaliseMemoryPath(note.path)).toBe(note.path);
    expect(note.content).toContain('- TRAINING: ride 3x this week');
    expect(note.content.split('\n').filter(l => l.startsWith('- '))).toHaveLength(12);
  });

  it('prunes only the oldest advice files, never the coach\'s own notes', () => {
    const files = [
      ...Array.from({ length: 15 }, (_, i) => ({
        path: `/memories/advice/2026-${String(i + 1).padStart(2, '0')}-01-weekly.md`, content: 'x', updated_at: '2026-01-01T00:00:00Z',
      })),
      { path: '/memories/injuries.md', content: 'x', updated_at: '2020-01-01T00:00:00Z' },
    ];
    const stale = staleAdviceFiles(files, 12);
    expect(stale).toHaveLength(3);
    expect(stale).toContain('/memories/advice/2026-01-01-weekly.md');
    expect(stale).not.toContain('/memories/injuries.md');
  });
});
