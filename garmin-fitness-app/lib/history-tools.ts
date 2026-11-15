// Look-up tools for the chat: fixed, parameterised queries over the full
// history. The model chooses a table, columns, dates and a function — never
// SQL — and everything is computed in memory over the same tables the reports
// use (lib/raw-data.ts), so a look-up and a report cannot disagree.
//
// Empty cells are skipped in every calculation: not recorded is not zero.

import { buildRawTables, type RawDataInput } from '@/lib/raw-data';

export const HISTORY_TABLES = ['wellness', 'activities', 'nutrition', 'meals', 'exercise_log', 'travel'] as const;
export type HistoryTable = typeof HISTORY_TABLES[number];

export const MAX_ROWS_RETURNED = 60;

export interface ParsedTable {
  columns: string[];
  rows: string[][];
}

/** Parses the CSV this app writes (quoted cells, doubled quotes). */
export function parseCsv(csv: string): ParsedTable {
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); lines.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell);
  lines.push(row);
  const [columns, ...rows] = lines;
  return { columns: columns ?? [], rows: rows.filter(r => r.length === (columns ?? []).length) };
}

export type HistoryTables = Partial<Record<HistoryTable, ParsedTable>>;

export function buildHistoryTables(input: RawDataInput): HistoryTables {
  const raw = buildRawTables(input);
  const out: HistoryTables = {};
  for (const t of HISTORY_TABLES) {
    const csv = raw[`${t}.csv`];
    if (csv) out[t] = parseCsv(csv);
  }
  return out;
}

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const csvCell = (v: string) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The column that dates a row. travel.csv has no `date`. */
function dateColumn(table: ParsedTable): number {
  const i = table.columns.indexOf('date');
  return i >= 0 ? i : table.columns.indexOf('depart_date');
}

function describeTables(tables: HistoryTables): string {
  return HISTORY_TABLES
    .filter(t => tables[t])
    .map(t => {
      const tb = tables[t]!;
      const d = dateColumn(tb);
      const dates = tb.rows.map(r => r[d]).filter(Boolean).sort();
      return `${t} (${tb.rows.length} rows, ${dates[0] ?? '?'} to ${dates[dates.length - 1] ?? '?'}): ${tb.columns.join(', ')}`;
    })
    .join('\n');
}

interface Filter { column?: unknown; op?: unknown; value?: unknown }

function selectRows(table: ParsedTable, args: { from?: unknown; to?: unknown; filter?: Filter }): string[][] | string {
  const d = dateColumn(table);
  let rows = table.rows;
  if (args.from !== undefined && args.from !== null && args.from !== '') {
    if (!isDate(args.from)) return 'Error: from must be YYYY-MM-DD.';
    rows = rows.filter(r => r[d] >= (args.from as string));
  }
  if (args.to !== undefined && args.to !== null && args.to !== '') {
    if (!isDate(args.to)) return 'Error: to must be YYYY-MM-DD.';
    rows = rows.filter(r => r[d] <= (args.to as string));
  }
  const f = args.filter;
  if (f && f.column !== undefined && f.column !== null && f.column !== '') {
    const col = table.columns.indexOf(String(f.column));
    if (col < 0) return `Error: no column "${String(f.column)}". Columns: ${table.columns.join(', ')}`;
    const value = String(f.value ?? '');
    const num = Number(value);
    switch (f.op) {
      case 'contains': rows = rows.filter(r => r[col].toLowerCase().includes(value.toLowerCase())); break;
      case '=':  rows = rows.filter(r => r[col] !== '' && (Number.isFinite(num) && value !== '' ? Number(r[col]) === num : r[col].toLowerCase() === value.toLowerCase())); break;
      case '>=': case '<=': case '>': case '<': {
        if (!Number.isFinite(num) || value === '') return `Error: ${String(f.op)} needs a number.`;
        const op = f.op;
        // An empty cell is not recorded: it matches no numeric comparison.
        rows = rows.filter(r => {
          if (r[col] === '') return false;
          const v = Number(r[col]);
          return Number.isFinite(v) && (op === '>=' ? v >= num : op === '<=' ? v <= num : op === '>' ? v > num : v < num);
        });
        break;
      }
      default: return 'Error: filter op must be one of =, >=, <=, >, <, contains.';
    }
  }
  return rows;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Runs one look-up. Always returns text for the model; never throws on bad input. */
export function runHistoryTool(tables: HistoryTables, name: string, rawArgs: unknown): string {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;

  if (name === 'list_history_tables') return describeTables(tables) || 'No data.';

  const tableName = String(args.table ?? '') as HistoryTable;
  const table = tables[tableName];
  if (!HISTORY_TABLES.includes(tableName) || !table) {
    return `Error: unknown or empty table "${String(args.table)}". Tables:\n${describeTables(tables)}`;
  }
  const selected = selectRows(table, { from: args.from, to: args.to, filter: args.filter as Filter | undefined });
  if (typeof selected === 'string') return selected;

  if (name === 'query_history') {
    const wanted = Array.isArray(args.columns) && args.columns.length ? args.columns.map(String) : table.columns;
    const unknown = wanted.filter(c => !table.columns.includes(c));
    if (unknown.length) return `Error: no column ${unknown.map(c => `"${c}"`).join(', ')}. Columns: ${table.columns.join(', ')}`;
    const idx = wanted.map(c => table.columns.indexOf(c));

    let rows = selected;
    if (args.sort_by !== undefined && args.sort_by !== null && args.sort_by !== '') {
      const col = table.columns.indexOf(String(args.sort_by));
      if (col < 0) return `Error: no column "${String(args.sort_by)}" to sort by.`;
      const desc = args.descending !== false;
      // Rows with nothing in the sort column go last either way.
      rows = [...rows].sort((a, b) => {
        if (a[col] === '' || b[col] === '') return a[col] === '' ? (b[col] === '' ? 0 : 1) : -1;
        const na = Number(a[col]), nb = Number(b[col]);
        const cmp = Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a[col].localeCompare(b[col]);
        return desc ? -cmp : cmp;
      });
    }
    const limit = Math.min(MAX_ROWS_RETURNED, Math.max(1, Number(args.limit) || MAX_ROWS_RETURNED));
    const shown = rows.slice(0, limit);
    if (shown.length === 0) return 'No rows match.';
    const body = [wanted.join(','), ...shown.map(r => idx.map(i => csvCell(r[i])).join(','))].join('\n');
    const more = rows.length - shown.length;
    return more > 0
      ? `${body}\n(${more} more rows match and are not shown. Narrow the dates, sort and limit, or use aggregate_history.)`
      : body;
  }

  if (name === 'aggregate_history') {
    const col = table.columns.indexOf(String(args.column ?? ''));
    if (col < 0) return `Error: no column "${String(args.column)}". Columns: ${table.columns.join(', ')}`;
    const fn = String(args.fn ?? '');
    if (!['max', 'min', 'avg', 'sum', 'count'].includes(fn)) return 'Error: fn must be max, min, avg, sum or count.';
    const groupBy = String(args.group_by ?? 'none');
    const d = dateColumn(table);
    const weekdayCol = table.columns.indexOf('weekday');
    const keyOf = (r: string[]): string | null => {
      switch (groupBy) {
        case 'none': return 'all';
        case 'year': return r[d].slice(0, 4);
        case 'month': return r[d].slice(0, 7);
        case 'weekday': return weekdayCol >= 0 ? r[weekdayCol] : null;
        default: return null;
      }
    };
    if (keyOf(selected[0] ?? table.rows[0] ?? []) === null) {
      return groupBy === 'weekday' ? `Error: ${tableName} has no weekday column.` : 'Error: group_by must be none, year, month or weekday.';
    }

    const groups = new Map<string, { values: number[]; best: string[] | null }>();
    let skipped = 0;
    for (const r of selected) {
      // Not recorded is not zero: an empty cell takes no part in any function.
      if (r[col] === '') { skipped++; continue; }
      const v = Number(r[col]);
      if (fn !== 'count' && !Number.isFinite(v)) { skipped++; continue; }
      const g = groups.get(keyOf(r)!) ?? { values: [], best: null };
      g.values.push(v);
      if (fn === 'max' && (g.best === null || v > Number(g.best[col]))) g.best = r;
      if (fn === 'min' && (g.best === null || v < Number(g.best[col]))) g.best = r;
      groups.set(keyOf(r)!, g);
    }
    if (groups.size === 0) return `No recorded values of ${table.columns[col]} in that selection (${selected.length} rows, all empty).`;

    const order = groupBy === 'weekday'
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].filter(k => groups.has(k))
      : [...groups.keys()].sort();
    const lines = order.map(key => {
      const g = groups.get(key)!;
      const n = g.values.length;
      const value =
        fn === 'count' ? n
        : fn === 'sum' ? round(g.values.reduce((s, x) => s + x, 0))
        : fn === 'avg' ? round(g.values.reduce((s, x) => s + x, 0) / n)
        : fn === 'max' ? Math.max(...g.values) : Math.min(...g.values);
      const label = groupBy === 'none' ? '' : `${key}: `;
      const where = g.best ? ` — ${table.columns.map((c, i) => (g.best![i] !== '' && i !== col ? `${c}=${g.best![i]}` : '')).filter(Boolean).slice(0, 8).join(', ')}` : '';
      return `${label}${fn}(${table.columns[col]}) = ${value} (n=${n})${where}`;
    });
    if (skipped > 0) lines.push(`(${skipped} rows had no recorded value and were left out.)`);
    return lines.join('\n');
  }

  return 'Error: unknown tool.';
}

/** Tool definitions (JSON Schema) for the three look-ups. */
export const HISTORY_TOOL_DEFS = [
  {
    name: 'list_history_tables',
    description: 'Lists the tables of the person\'s full history with their columns, row counts and date ranges. Call this first if unsure what exists.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'query_history',
    description: `Returns rows from one table of the full history as CSV (at most ${MAX_ROWS_RETURNED} rows). Use for specific days or the top few of something: sort_by with a small limit. An empty cell means not recorded.`,
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: [...HISTORY_TABLES] },
        from: { type: 'string', description: 'First date, YYYY-MM-DD. Optional.' },
        to: { type: 'string', description: 'Last date, YYYY-MM-DD. Optional.' },
        columns: { type: 'array', items: { type: 'string' }, description: 'Columns to return. Optional; default all.' },
        filter: {
          type: 'object',
          description: 'Optional: keep rows where column op value holds.',
          properties: {
            column: { type: 'string' },
            op: { type: 'string', enum: ['=', '>=', '<=', '>', '<', 'contains'] },
            value: { type: 'string' },
          },
          required: ['column', 'op', 'value'],
          additionalProperties: false,
        },
        sort_by: { type: 'string', description: 'Column to sort by. Optional.' },
        descending: { type: 'boolean', description: 'Largest first. Default true.' },
        limit: { type: 'integer', description: `Rows to return, at most ${MAX_ROWS_RETURNED}.` },
      },
      required: ['table'],
      additionalProperties: false,
    },
  },
  {
    name: 'aggregate_history',
    description: 'Computes max, min, avg, sum or count of one numeric column over a date range, optionally per year, month or weekday. max and min also return the row they came from. Rows with no recorded value are left out, never counted as zero.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: [...HISTORY_TABLES] },
        column: { type: 'string' },
        fn: { type: 'string', enum: ['max', 'min', 'avg', 'sum', 'count'] },
        from: { type: 'string', description: 'First date, YYYY-MM-DD. Optional.' },
        to: { type: 'string', description: 'Last date, YYYY-MM-DD. Optional.' },
        group_by: { type: 'string', enum: ['none', 'year', 'month', 'weekday'] },
        filter: {
          type: 'object',
          description: 'Optional: keep rows where column op value holds, e.g. type = cycling.',
          properties: {
            column: { type: 'string' },
            op: { type: 'string', enum: ['=', '>=', '<=', '>', '<', 'contains'] },
            value: { type: 'string' },
          },
          required: ['column', 'op', 'value'],
          additionalProperties: false,
        },
      },
      required: ['table', 'column', 'fn'],
      additionalProperties: false,
    },
  },
] as const;

export const HISTORY_INSTRUCTIONS = `The profile above covers the last 90 days. For anything older, or any exact figure it does not contain (a personal best, a date, a count, a monthly average), look it up with the history tools instead of estimating: list_history_tables, query_history, aggregate_history. They read the person's complete history. Say what you looked up when it matters to the answer.`;
