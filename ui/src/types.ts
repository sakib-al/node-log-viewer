export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LevelFilter = LogLevel | 'all';

export const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  id: string;
  ts: string;
  level: LogLevel;
  message: string;
  source?: string;
  context?: Record<string, unknown>;
  error?: SerializedError;
}

export interface LevelCounts {
  all: number;
  debug: number;
  info: number;
  warn: number;
  error: number;
}

export interface DateFileInfo {
  date: string;
  file: string;
  sizeBytes: number;
  count: number;
  counts: LevelCounts;
  modifiedAt: string;
}

export interface ReadResult {
  date: string;
  entries: LogEntry[];
  page: number;
  pageSize: number;
  total: number;
  counts: LevelCounts;
}

export interface Meta {
  title: string;
  version: string;
  base: string;
  levels: LogLevel[];
  dir: string;
  allowDelete: boolean;
  allowPluginConfig: boolean;
  now: string;
}

export type SettingsField =
  | { key: string; label: string; type: 'text' | 'password' | 'url' | 'number'; description?: string; placeholder?: string; required?: boolean }
  | { key: string; label: string; type: 'boolean'; description?: string }
  | { key: string; label: string; type: 'select'; description?: string; options: Array<{ value: string; label: string }> };

export interface PluginView {
  name: string;
  title: string;
  description?: string;
  enabled: boolean;
  minLevel?: string;
  configurable: boolean;
  testable: boolean;
  settingsSchema: SettingsField[];
  config: Record<string, unknown>;
  secretsSet: string[];
}
