// Postgres-backed store for the coach's memory (see lib/coach-memory.ts).

import { sql } from '@vercel/postgres';
import {
  adviceNote, memoryPromptSection, staleAdviceFiles, type MemoryFile, type MemoryStore,
} from '@/lib/coach-memory';

let ready: Promise<void> | null = null;

/** CREATE TABLE once per server instance, not on every request. */
function ensureTable(): Promise<void> {
  ready ??= sql`
    CREATE TABLE IF NOT EXISTS coach_memory (
      path TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.then(() => undefined, (e) => { ready = null; throw e; });
  return ready;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toFile = (r: any): MemoryFile => ({
  path: String(r.path),
  content: String(r.content),
  updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
});

export const postgresMemoryStore: MemoryStore = {
  async list() {
    await ensureTable();
    const { rows } = await sql`SELECT path, content, updated_at FROM coach_memory ORDER BY path`;
    return rows.map(toFile);
  },
  async get(path) {
    await ensureTable();
    const { rows } = await sql`SELECT path, content, updated_at FROM coach_memory WHERE path = ${path}`;
    return rows[0] ? toFile(rows[0]) : null;
  },
  async put(path, content) {
    await ensureTable();
    await sql`
      INSERT INTO coach_memory (path, content, updated_at) VALUES (${path}, ${content}, NOW())
      ON CONFLICT (path) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()
    `;
  },
  async remove(path) {
    await ensureTable();
    const { rowCount } = await sql`DELETE FROM coach_memory WHERE path = ${path}`;
    return (rowCount ?? 0) > 0;
  },
};

/** The memory as a prompt section. Never throws: a broken memory must not break the coach. */
export async function loadMemorySection(): Promise<string | undefined> {
  try {
    return memoryPromptSection(await postgresMemoryStore.list());
  } catch (e) {
    console.error('[coach-memory] could not load', e);
    return undefined;
  }
}

/** Records what was advised, and prunes the oldest advice files. Never throws. */
export async function recordAdvice(kind: 'weekly' | 'monthly' | 'deep', headline: string, advice: string[]): Promise<void> {
  try {
    const note = adviceNote(kind, new Date().toISOString().slice(0, 10), headline, advice);
    await postgresMemoryStore.put(note.path, note.content);
    for (const path of staleAdviceFiles(await postgresMemoryStore.list())) {
      await postgresMemoryStore.remove(path);
    }
  } catch (e) {
    console.error('[coach-memory] could not record advice', e);
  }
}
