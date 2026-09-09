import type {
  DateFileInfo,
  LevelCounts,
  LogEntry,
  LogLevel,
  ReadQuery,
  ReadResult,
} from '../types.js';
import { isLogLevel } from '../types.js';
import { safeStringify } from '../utils.js';
import type { FileStore } from './file-store.js';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;

export function emptyCounts(): LevelCounts {
  return { all: 0, debug: 0, info: 0, warn: 0, error: 0 };
}

/** Parses JSON-lines content into entries. Unparseable lines become `info` entries with the raw text. */
export function parseLines(raw: string): LogEntry[] {
  if (!raw) return [];
  const out: LogEntry[] = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as Partial<LogEntry>;
      if (obj && typeof obj === 'object' && typeof obj.message === 'string' && typeof obj.ts === 'string') {
        out.push({
          id: typeof obj.id === 'string' ? obj.id : `line-${i}`,
          ts: obj.ts,
          level: isLogLevel(obj.level) ? obj.level : 'info',
          message: obj.message,
          source: typeof obj.source === 'string' ? obj.source : undefined,
          context: obj.context && typeof obj.context === 'object' ? obj.context : undefined,
          error: obj.error && typeof obj.error === 'object' ? obj.error : undefined,
        });
        continue;
      }
    } catch {
      // fall through to raw handling
    }
    out.push({ id: `line-${i}`, ts: new Date(0).toISOString(), level: 'info', message: line, source: 'raw' });
  }
  return out;
}

function haystack(entry: LogEntry): string {
  const parts = [entry.message, entry.source ?? '', entry.level];
  if (entry.context) parts.push(safeStringify(entry.context));
  if (entry.error) {
    parts.push(entry.error.name, entry.error.message, entry.error.stack ?? '');
  }
  return parts.join('\n').toLowerCase();
}

export function matchesSearch(entry: LogEntry, search: string | undefined): boolean {
  if (!search) return true;
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return haystack(entry).includes(needle);
}

export function countLevels(entries: LogEntry[]): LevelCounts {
  const counts = emptyCounts();
  for (const e of entries) {
    counts.all += 1;
    counts[e.level] += 1;
  }
  return counts;
}

export class LogReader {
  constructor(private readonly store: FileStore) {}

  async listDates(): Promise<DateFileInfo[]> {
    const dates = await this.store.listDates();
    const infos = await Promise.all(
      dates.map(async (date): Promise<DateFileInfo> => {
        const [raw, stat] = await Promise.all([this.store.readRaw(date), this.store.stat(date)]);
        const entries = parseLines(raw);
        return {
          date,
          file: this.store.fileFor(date),
          sizeBytes: stat?.sizeBytes ?? 0,
          modifiedAt: stat?.modifiedAt ?? new Date(0).toISOString(),
          count: entries.length,
          counts: countLevels(entries),
        };
      }),
    );
    return infos;
  }

  async readAll(date: string): Promise<LogEntry[]> {
    return parseLines(await this.store.readRaw(date));
  }

  async read(query: ReadQuery): Promise<ReadResult> {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(query.pageSize ?? DEFAULT_PAGE_SIZE)));
    const order = query.order ?? 'desc';
    const level: LogLevel | 'all' = query.level && isLogLevel(query.level) ? query.level : 'all';

    const all = await this.readAll(query.date);
    const searched = all.filter((e) => matchesSearch(e, query.search));
    const counts = countLevels(searched);
    const filtered = level === 'all' ? searched : searched.filter((e) => e.level === level);

    if (order === 'desc') filtered.reverse();

    const start = (page - 1) * pageSize;
    const entries = filtered.slice(start, start + pageSize);

    return { date: query.date, entries, page, pageSize, total: filtered.length, counts };
  }
}
