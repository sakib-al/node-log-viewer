import type { LogLevel } from './types';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export const LEVEL_STYLES: Record<LogLevel, { badge: string; dot: string; tab: string; label: string }> = {
  debug: {
    badge: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    dot: 'bg-slate-400',
    tab: 'text-slate-600 dark:text-slate-300',
    label: 'Debug',
  },
  info: {
    badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
    dot: 'bg-sky-500',
    tab: 'text-sky-700 dark:text-sky-300',
    label: 'Info',
  },
  warn: {
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
    dot: 'bg-amber-500',
    tab: 'text-amber-700 dark:text-amber-300',
    label: 'Warning',
  },
  error: {
    badge: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200',
    dot: 'bg-rose-500',
    tab: 'text-rose-700 dark:text-rose-300',
    label: 'Error',
  },
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
    `.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

export function formatDateLabel(dateKey: string): string {
  const today = toKey(new Date());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (dateKey === today) return 'Today';
  if (dateKey === toKey(y)) return 'Yesterday';
  const d = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function toKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
