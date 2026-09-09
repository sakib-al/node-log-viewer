import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger, parseLines, type LogEntry, type LogViewerPlugin } from '../src/index.js';
import { toDateKey } from '../src/core/utils.js';
import { rm, tmpDir } from './helpers.js';

let dir: string;
beforeEach(async () => {
  dir = await tmpDir();
});
afterEach(async () => {
  await rm(dir);
});

describe('Logger + FileStore', () => {
  it('writes JSONL entries to a daily file and creates a .gitignore', async () => {
    const logger = createLogger({ dir, console: false });
    logger.info('hello', { a: 1 });
    logger.warn('careful');
    logger.debug('dbg');
    await logger.flush();

    const file = path.join(dir, `${toDateKey()}.log`);
    const raw = await fs.readFile(file, 'utf8');
    const entries = parseLines(raw);
    expect(entries.map((e) => e.level)).toEqual(['info', 'warn', 'debug']);
    expect(entries[0].message).toBe('hello');
    expect(entries[0].context).toEqual({ a: 1 });
    expect(entries[0].id).toMatch(/^[0-9a-f]{24}$/);

    const gitignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('*');
    expect(gitignore).toContain('!.gitignore');
  });

  it('does not write .gitignore when disabled', async () => {
    const logger = createLogger({ dir, console: false, gitignore: false });
    logger.info('x');
    await logger.flush();
    await expect(fs.access(path.join(dir, '.gitignore'))).rejects.toThrow();
  });

  it('respects the minimum level', async () => {
    const logger = createLogger({ dir, console: false, level: 'warn' });
    expect(logger.debug('no')).toBeUndefined();
    expect(logger.info('no')).toBeUndefined();
    expect(logger.warn('yes')).toBeDefined();
    await logger.flush();
    const entries = await logger.reader.readAll(toDateKey());
    expect(entries).toHaveLength(1);
  });

  it('serializes exceptions with stack, cause and own properties', async () => {
    const logger = createLogger({ dir, console: false });
    const cause = new Error('root cause');
    const err = Object.assign(new TypeError('bad thing', { cause }), { code: 'E_BAD', statusCode: 500 });
    const entry = logger.exception(err, { userId: 7 }) as LogEntry;

    expect(entry.level).toBe('error');
    expect(entry.message).toBe('TypeError: bad thing');
    expect(entry.error?.name).toBe('TypeError');
    expect(entry.error?.stack).toContain('bad thing');
    expect(entry.error?.code).toBe('E_BAD');
    expect((entry.error?.cause as { message: string }).message).toBe('root cause');
    expect(entry.context).toEqual({ userId: 7 });

    await logger.flush();
    const [stored] = await logger.reader.readAll(toDateKey());
    expect(stored.error?.name).toBe('TypeError');
  });

  it('accepts an Error as the context of error()/warn() and as the first argument of error()', async () => {
    const logger = createLogger({ dir, console: false });
    const e1 = logger.error('failed', new Error('boom')) as LogEntry;
    expect(e1.message).toBe('failed');
    expect(e1.error?.message).toBe('boom');
    expect(e1.context).toBeUndefined();

    const e2 = logger.error(new RangeError('out of range')) as LogEntry;
    expect(e2.message).toBe('RangeError: out of range');

    const e3 = logger.warn('with error in ctx', { error: new Error('inner'), retry: 2 }) as LogEntry;
    expect(e3.error?.message).toBe('inner');
    expect(e3.context).toEqual({ retry: 2 });
    await logger.flush();
  });

  it('handles circular / exotic context values safely', async () => {
    const logger = createLogger({ dir, console: false });
    const circ: Record<string, unknown> = { name: 'c' };
    circ.self = circ;
    const entry = logger.info('circ', { circ, big: 10n, fn: () => 1, when: new Date(0) }) as LogEntry;
    expect(entry.context).toMatchObject({ big: '10n', when: '1970-01-01T00:00:00.000Z' });
    expect((entry.context?.circ as { self: unknown }).self).toBe('[Circular]');
    expect(() => JSON.stringify(entry)).not.toThrow();
    await logger.flush();
  });

  it('child loggers share storage and add source + context', async () => {
    const logger = createLogger({ dir, console: false, source: 'root' });
    const child = logger.child({ source: 'Db', context: { requestId: 'r1' } });
    const grandchild = child.child({ context: { table: 'users' } });
    grandchild.info('query', { ms: 3 });
    child.info('connected');
    logger.info('root msg');
    await logger.flush();

    const entries = await logger.reader.readAll(toDateKey());
    expect(entries[0]).toMatchObject({ source: 'Db', context: { requestId: 'r1', table: 'users', ms: 3 } });
    expect(entries[1]).toMatchObject({ source: 'Db', context: { requestId: 'r1' } });
    expect(entries[2]).toMatchObject({ source: 'root' });
    expect(entries[2].context).toBeUndefined();
  });

  it('dispatches to plugins honouring minLevel and isolating failures', async () => {
    const received: string[] = [];
    const good: LogViewerPlugin = { name: 'good', minLevel: 'warn', onLog: (e) => void received.push(e.level) };
    const bad: LogViewerPlugin = {
      name: 'bad',
      onLog: () => {
        throw new Error('plugin exploded');
      },
    };
    const rejecting: LogViewerPlugin = { name: 'rej', onLog: async () => Promise.reject(new Error('async fail')) };
    const errors: string[] = [];
    const orig = console.error;
    console.error = (msg: string) => void errors.push(String(msg));
    try {
      const logger = createLogger({ dir, console: false, plugins: [good, bad, rejecting] });
      logger.info('i');
      logger.warn('w');
      logger.error('e');
      await logger.flush();
    } finally {
      console.error = orig;
    }
    expect(received).toEqual(['warn', 'error']);
    expect(errors.some((m) => m.includes('"bad"') && m.includes('plugin exploded'))).toBe(true);
    expect(errors.some((m) => m.includes('"rej"') && m.includes('async fail'))).toBe(true);
  });

  it('re-applies persisted plugin settings on startup', async () => {
    let configured: Record<string, unknown> | null = null;
    const plugin: LogViewerPlugin = {
      name: 'p',
      onLog: () => undefined,
      configure: (c) => {
        configured = c;
      },
    };
    const first = createLogger({ dir, console: false });
    await first.settings.setPluginConfig('p', { token: 'abc', enabled: true });

    const second = createLogger({ dir, console: false, plugins: [plugin] });
    await second.ready();
    expect(configured).toEqual({ token: 'abc', enabled: true });
  });
});

describe('LogReader', () => {
  it('filters, searches, counts and paginates', async () => {
    const logger = createLogger({ dir, console: false });
    for (let i = 0; i < 30; i++) logger.info(`request ${i}`, { path: `/items/${i}` });
    logger.warn('slow query', { sql: 'SELECT secret_table' });
    logger.error('db down', new Error('ECONNRESET'));
    await logger.flush();
    const date = toDateKey();

    const all = await logger.reader.read({ date });
    expect(all.total).toBe(32);
    expect(all.counts).toEqual({ all: 32, debug: 0, info: 30, warn: 1, error: 1 });
    expect(all.entries).toHaveLength(32);
    expect(all.entries[0].message).toBe('db down'); // newest first

    const page = await logger.reader.read({ date, pageSize: 10, page: 4, order: 'asc' });
    expect(page.entries).toHaveLength(2);
    expect(page.entries.map((e) => e.level)).toEqual(['warn', 'error']);

    const onlyErrors = await logger.reader.read({ date, level: 'error' });
    expect(onlyErrors.total).toBe(1);
    expect(onlyErrors.counts.all).toBe(32); // counts ignore the level filter

    const searched = await logger.reader.read({ date, search: 'SECRET_table' });
    expect(searched.total).toBe(1);
    expect(searched.entries[0].message).toBe('slow query');

    const stackSearch = await logger.reader.read({ date, search: 'econnreset' });
    expect(stackSearch.total).toBe(1);

    const list = await logger.reader.listDates();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ date, count: 32, counts: { error: 1 } });
    expect(list[0].sizeBytes).toBeGreaterThan(0);
  });

  it('keeps unparseable lines visible as raw entries', () => {
    const entries = parseLines('not json at all\n{"ts":"2026-01-01T00:00:00.000Z","level":"info","message":"ok"}\n\n');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ source: 'raw', message: 'not json at all', level: 'info' });
    expect(entries[1].message).toBe('ok');
  });

  it('deletes and lists files, rejecting bad date keys', async () => {
    const logger = createLogger({ dir, console: false });
    logger.info('x');
    await logger.flush();
    const date = toDateKey();
    expect(await logger.store.listDates()).toEqual([date]);
    expect(await logger.store.delete(date)).toBe(true);
    expect(await logger.store.delete(date)).toBe(false);
    await expect(logger.store.delete('../etc/passwd')).rejects.toThrow(/Invalid date key/);
    expect(await logger.store.listDates()).toEqual([]);
  });
});
