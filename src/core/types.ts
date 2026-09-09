/** Supported log levels, ordered from least to most severe. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'] as const;

export const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

/** Returns true when `level` is at least as severe as `min`. */
export function levelAtLeast(level: LogLevel, min: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[min];
}

/** Serialized representation of an Error attached to a log entry. */
export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  /** Arbitrary own properties on the error (e.g. `code`, `statusCode`). */
  [key: string]: unknown;
}

/** Arbitrary structured data attached to a log entry. */
export type LogContext = Record<string, unknown>;

/** One line in a daily log file. */
export interface LogEntry {
  /** Unique id (time-sortable). */
  id: string;
  /** ISO-8601 timestamp. */
  ts: string;
  level: LogLevel;
  message: string;
  /** Optional named source (e.g. Nest class name, module, request id). */
  source?: string;
  context?: LogContext;
  error?: SerializedError;
}

export interface LoggerOptions {
  /** Directory where daily log files are written. Default: `logs` (relative to cwd). */
  dir?: string;
  /** Minimum level that will be recorded. Default: `debug`. */
  level?: LogLevel;
  /** Mirror entries to the console. Default: `true` when NODE_ENV !== 'production'. */
  console?: boolean;
  /** Write a `.gitignore` inside `dir` so log files are never committed. Default: `true`. */
  gitignore?: boolean;
  /** Default `source` for entries created by this logger. */
  source?: string;
  /** Plugins to register at construction time. */
  plugins?: import('../plugins/plugin.js').LogViewerPlugin[];
  /** File extension used for daily files. Default: `log`. */
  extension?: string;
}

export interface ReadQuery {
  /** Date file to read, formatted `YYYY-MM-DD`. */
  date: string;
  /** Filter by level. `all` or undefined returns everything. */
  level?: LogLevel | 'all';
  /** Case-insensitive substring search over message, source, context and error. */
  search?: string;
  /** 1-based page number. Default 1. */
  page?: number;
  /** Page size. Default 50, max 500. */
  pageSize?: number;
  /** Sort order by timestamp. Default `desc` (newest first). */
  order?: 'asc' | 'desc';
}

export interface LevelCounts {
  all: number;
  debug: number;
  info: number;
  warn: number;
  error: number;
}

export interface ReadResult {
  date: string;
  entries: LogEntry[];
  page: number;
  pageSize: number;
  /** Total entries matching the filter (before pagination). */
  total: number;
  /** Level counts for the whole day (ignores level filter, respects search). */
  counts: LevelCounts;
}

export interface DateFileInfo {
  /** `YYYY-MM-DD` */
  date: string;
  file: string;
  sizeBytes: number;
  /** Total number of entries in the file. */
  count: number;
  counts: LevelCounts;
  modifiedAt: string;
}
