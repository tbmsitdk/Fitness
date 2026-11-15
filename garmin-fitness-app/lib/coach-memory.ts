// The coach's memory: small text files it can read and write across sessions,
// through the API's memory tool. Storage is injected, so the command logic is
// testable without a database (lib/coach-memory-db.ts is the Postgres store).
//
// The model chooses the paths and contents, so every command is validated here:
// one flat namespace under /memories, capped in count and size, no traversal.

export interface MemoryFile {
  path: string;
  content: string;
  updated_at: string;
}

export interface MemoryStore {
  list(): Promise<MemoryFile[]>;
  get(path: string): Promise<MemoryFile | null>;
  put(path: string, content: string): Promise<void>;
  remove(path: string): Promise<boolean>;
}

export const MEMORY_ROOT = '/memories';
export const MAX_MEMORY_FILES = 40;
export const MAX_MEMORY_FILE_CHARS = 12_000;

export type MemoryCommand =
  | { command: 'view'; path: string; view_range?: number[] }
  | { command: 'create'; path: string; file_text: string }
  | { command: 'str_replace'; path: string; old_str: string; new_str: string }
  | { command: 'insert'; path: string; insert_line: number; insert_text: string }
  | { command: 'delete'; path: string }
  | { command: 'rename'; old_path: string; new_path: string };

/**
 * Normalises a path the model supplied, or returns null if it is not a plain
 * file path under /memories. Rejects traversal, empty segments and odd
 * characters rather than trying to repair them.
 */
export function normaliseMemoryPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const path = raw.trim().replace(/\/+$/, '');
  if (path === MEMORY_ROOT) return MEMORY_ROOT;
  if (!path.startsWith(`${MEMORY_ROOT}/`) || path.length > 200) return null;
  const segments = path.slice(MEMORY_ROOT.length + 1).split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') return null;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(seg)) return null;
  }
  return path;
}

const numbered = (text: string, from = 1) =>
  text.split('\n').map((line, i) => `${String(i + from).padStart(4)}\t${line}`).join('\n');

/** Runs one memory command. Always returns text for the model; never throws on bad input. */
export async function runMemoryCommand(store: MemoryStore, cmd: MemoryCommand): Promise<string> {
  switch (cmd.command) {
    case 'view': {
      const path = normaliseMemoryPath(cmd.path);
      if (!path) return `Error: ${String(cmd.path)} is not a valid path under ${MEMORY_ROOT}.`;
      const files = await store.list();
      if (path === MEMORY_ROOT || files.some(f => f.path.startsWith(`${path}/`))) {
        const inside = files.filter(f => path === MEMORY_ROOT || f.path.startsWith(`${path}/`));
        if (inside.length === 0) return `${path} is empty.`;
        return `Files in ${path}:\n` + inside.map(f => `${f.path} (${f.content.length} chars, updated ${f.updated_at.slice(0, 10)})`).join('\n');
      }
      const file = files.find(f => f.path === path);
      if (!file) return `Error: ${path} does not exist.`;
      const lines = file.content.split('\n');
      const [start, end] = Array.isArray(cmd.view_range) && cmd.view_range.length === 2
        ? [Math.max(1, cmd.view_range[0]), cmd.view_range[1] === -1 ? lines.length : Math.min(lines.length, cmd.view_range[1])]
        : [1, lines.length];
      return numbered(lines.slice(start - 1, end).join('\n'), start);
    }

    case 'create': {
      const path = normaliseMemoryPath(cmd.path);
      if (!path || path === MEMORY_ROOT) return `Error: ${String(cmd.path)} is not a valid file path under ${MEMORY_ROOT}.`;
      if (typeof cmd.file_text !== 'string') return 'Error: file_text is required.';
      if (cmd.file_text.length > MAX_MEMORY_FILE_CHARS) {
        return `Error: file is ${cmd.file_text.length} chars; the limit is ${MAX_MEMORY_FILE_CHARS}. Store less, or split it.`;
      }
      const files = await store.list();
      if (!files.some(f => f.path === path) && files.length >= MAX_MEMORY_FILES) {
        return `Error: memory holds ${files.length} files, the limit is ${MAX_MEMORY_FILES}. Delete or merge old files first.`;
      }
      await store.put(path, cmd.file_text);
      return `Saved ${path}.`;
    }

    case 'str_replace': {
      const path = normaliseMemoryPath(cmd.path);
      if (!path || path === MEMORY_ROOT) return `Error: ${String(cmd.path)} is not a valid file path.`;
      const file = await store.get(path);
      if (!file) return `Error: ${path} does not exist.`;
      if (typeof cmd.old_str !== 'string' || cmd.old_str === '') return 'Error: old_str is required.';
      const count = file.content.split(cmd.old_str).length - 1;
      if (count === 0) return `Error: old_str was not found in ${path}.`;
      if (count > 1) return `Error: old_str appears ${count} times in ${path}; make it unique.`;
      const next = file.content.replace(cmd.old_str, () => String(cmd.new_str ?? ''));
      if (next.length > MAX_MEMORY_FILE_CHARS) return `Error: the edit would make ${path} longer than ${MAX_MEMORY_FILE_CHARS} chars.`;
      await store.put(path, next);
      return `Edited ${path}.`;
    }

    case 'insert': {
      const path = normaliseMemoryPath(cmd.path);
      if (!path || path === MEMORY_ROOT) return `Error: ${String(cmd.path)} is not a valid file path.`;
      const file = await store.get(path);
      if (!file) return `Error: ${path} does not exist.`;
      const lines = file.content.split('\n');
      const at = Number(cmd.insert_line);
      if (!Number.isInteger(at) || at < 0 || at > lines.length) {
        return `Error: insert_line must be between 0 and ${lines.length}.`;
      }
      lines.splice(at, 0, String(cmd.insert_text ?? '').replace(/\n$/, ''));
      const next = lines.join('\n');
      if (next.length > MAX_MEMORY_FILE_CHARS) return `Error: the insert would make ${path} longer than ${MAX_MEMORY_FILE_CHARS} chars.`;
      await store.put(path, next);
      return `Inserted into ${path}.`;
    }

    case 'delete': {
      const path = normaliseMemoryPath(cmd.path);
      // Deleting the root would wipe everything in one call; make that impossible.
      if (!path || path === MEMORY_ROOT) return `Error: ${String(cmd.path)} is not a valid file path. Files are deleted one at a time.`;
      return (await store.remove(path)) ? `Deleted ${path}.` : `Error: ${path} does not exist.`;
    }

    case 'rename': {
      const from = normaliseMemoryPath(cmd.old_path);
      const to = normaliseMemoryPath(cmd.new_path);
      if (!from || !to || from === MEMORY_ROOT || to === MEMORY_ROOT) return 'Error: both paths must be valid file paths under /memories.';
      const file = await store.get(from);
      if (!file) return `Error: ${from} does not exist.`;
      if (await store.get(to)) return `Error: ${to} already exists.`;
      await store.put(to, file.content);
      await store.remove(from);
      return `Renamed ${from} to ${to}.`;
    }

    default:
      return 'Error: unknown memory command.';
  }
}

/** In-memory store, for tests. */
export function createInMemoryStore(initial: Record<string, string> = {}, now = () => new Date().toISOString()): MemoryStore {
  const files = new Map<string, MemoryFile>();
  for (const [path, content] of Object.entries(initial)) files.set(path, { path, content, updated_at: now() });
  return {
    async list() { return [...files.values()].sort((a, b) => a.path.localeCompare(b.path)); },
    async get(path) { return files.get(path) ?? null; },
    async put(path, content) { files.set(path, { path, content, updated_at: now() }); },
    async remove(path) { return files.delete(path); },
  };
}

export const MEMORY_INSTRUCTIONS = `You have a memory that lasts between conversations: text files under /memories, read and written with the memory tool. Its current contents are shown below, so you do not need to view files before answering.

Use it the way a coach keeps notes on an athlete:
- what you advised and when, and later whether it was followed and what happened
- commitments the person made, preferences, constraints, injuries and niggles
- things to follow up on next time

Do not copy data into it: the numbers are in the database and arrive fresh each time. Keep files short, dated and current; edit or delete a note that has gone stale instead of adding a contradicting one. Never store passwords, tokens or other secrets. Files under /memories/advice/ are written by the app after each report and review; read them, do not edit them.

When a note is relevant, use it and say so plainly ("three weeks ago I suggested…"). Save a note when something worth remembering comes up, without announcing it at length.`;

/** The memory as a prompt section, newest advice first, bounded in size. */
export function memoryPromptSection(files: MemoryFile[], maxChars = 24_000): string {
  if (files.length === 0) {
    return `${MEMORY_INSTRUCTIONS}\n\n<memory>\n(empty — nothing has been saved yet)\n</memory>`;
  }
  // Most recently updated first, so a tight budget drops the oldest notes.
  const ordered = [...files].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const parts: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const f of ordered) {
    const block = `### ${f.path} (updated ${f.updated_at.slice(0, 10)})\n${f.content}`;
    if (used + block.length > maxChars) { omitted++; continue; }
    parts.push(block);
    used += block.length;
  }
  const tail = omitted > 0 ? `\n\n(${omitted} older file${omitted === 1 ? '' : 's'} not shown; view them with the memory tool if needed.)` : '';
  return `${MEMORY_INSTRUCTIONS}\n\n<memory>\n${parts.join('\n\n')}${tail}\n</memory>`;
}

/** The record the app writes after a report or review: what was advised, on what date. */
export function adviceNote(kind: 'weekly' | 'monthly' | 'deep', date: string, headline: string, advice: string[]): { path: string; content: string } {
  const lines = [`# ${kind} advice, ${date}`, '', headline.trim().slice(0, 600), ''];
  for (const a of advice.slice(0, 12)) lines.push(`- ${a.replace(/\s+/g, ' ').trim().slice(0, 400)}`);
  return { path: `${MEMORY_ROOT}/advice/${date}-${kind}.md`, content: lines.join('\n').slice(0, MAX_MEMORY_FILE_CHARS) };
}

/**
 * Keeps the app-written advice log from crowding out the coach's own notes:
 * returns the advice files beyond the newest `keep`, for deletion.
 */
export function staleAdviceFiles(files: MemoryFile[], keep = 12): string[] {
  return files
    .filter(f => f.path.startsWith(`${MEMORY_ROOT}/advice/`))
    .sort((a, b) => b.path.localeCompare(a.path))
    .slice(keep)
    .map(f => f.path);
}
