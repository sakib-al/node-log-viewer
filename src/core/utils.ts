import { randomBytes } from 'node:crypto';
import type { LogContext, SerializedError } from './types.js';

let lastTime = 0;
let seq = 0;

/**
 * Generates a time-sortable unique id: `<ms hex><seq hex><random>`.
 * Avoids a dependency on ulid/uuid.
 */
export function generateId(now: number = Date.now()): string {
  if (now === lastTime) {
    seq += 1;
  } else {
    lastTime = now;
    seq = 0;
  }
  const time = now.toString(16).padStart(12, '0');
  const counter = seq.toString(16).padStart(4, '0');
  const rand = randomBytes(4).toString('hex');
  return `${time}${counter}${rand}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Formats a Date as `YYYY-MM-DD` in local time (used for daily file names). */
export function toDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: string): boolean {
  return DATE_KEY_RE.test(value);
}

export function isError(value: unknown): value is Error {
  return value instanceof Error || (typeof value === 'object' && value !== null && 'stack' in value && 'message' in value);
}

/** Converts an Error (or anything thrown) into a JSON-friendly object. */
export function serializeError(err: unknown): SerializedError {
  if (isError(err)) {
    const out: SerializedError = {
      name: err.name || 'Error',
      message: err.message,
      stack: err.stack,
    };
    for (const key of Object.keys(err)) {
      if (key === 'name' || key === 'message' || key === 'stack') continue;
      out[key] = safeValue((err as unknown as Record<string, unknown>)[key]);
    }
    if ((err as { cause?: unknown }).cause !== undefined) {
      out.cause = serializeError((err as { cause?: unknown }).cause);
    }
    return out;
  }
  if (typeof err === 'string') {
    return { name: 'Error', message: err };
  }
  return { name: 'NonError', message: safeStringify(err) };
}

/** Makes a value safe to JSON.stringify (handles circular refs, bigint, functions, errors). */
export function safeValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t === 'bigint') return `${(value as bigint).toString()}n`;
  if (t === 'function') return `[Function ${(value as Function).name || 'anonymous'}]`;
  if (t === 'symbol') return (value as symbol).toString();
  if (value instanceof Date) return value.toISOString();
  if (isError(value)) return serializeError(value);
  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);
    if (Array.isArray(value)) return value.map((v) => safeValue(v, seen));
    if (value instanceof Map) return safeValue(Object.fromEntries(value), seen);
    if (value instanceof Set) return safeValue([...value], seen);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = safeValue(v, seen);
    }
    return out;
  }
  return String(value);
}

export function safeStringify(value: unknown): string {
  try {
    const s = JSON.stringify(safeValue(value));
    return s === undefined ? String(value) : s;
  } catch {
    return String(value);
  }
}

export function normalizeContext(ctx: unknown): LogContext | undefined {
  if (ctx === undefined || ctx === null) return undefined;
  if (typeof ctx === 'object' && !Array.isArray(ctx) && !isError(ctx)) {
    const v = safeValue(ctx) as LogContext;
    return Object.keys(v).length ? v : undefined;
  }
  return { value: safeValue(ctx) };
}
