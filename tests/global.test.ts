import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogViewer, createLogger, getLogger, initLogger, isLoggerInitialized, log, resetLogger, setLogger } from '../src/index.js';
import { toDateKey } from '../src/core/utils.js';
import { rm, tmpDir } from './helpers.js';

let dir: string;
beforeEach(async () => {
  dir = await tmpDir();
  resetLogger();
});
afterEach(async () => {
  await log.flush().catch(() => undefined);
  resetLogger();
  await rm(dir);
});

describe('global logger', () => {
  it('initLogger() once, then log.* anywhere writes to the same files', async () => {
    expect(isLoggerInitialized()).toBe(false);
    const logger = initLogger({ dir, console: false });
    expect(isLoggerInitialized()).toBe(true);
    expect(getLogger()).toBe(logger);
    expect(log.instance).toBe(logger);

    log.info('from module A', { a: 1 });
    log.warn('from module B');
    log.exception(new Error('kaboom'), { where: 'module C' });
    log.child({ source: 'UsersService' }).debug('child works');
    await log.flush();

    const entries = await logger.reader.readAll(toDateKey());
    expect(entries.map((e) => [e.level, e.message])).toEqual([
      ['info', 'from module A'],
      ['warn', 'from module B'],
      ['error', 'Error: kaboom'],
      ['debug', 'child works'],
    ]);
    expect(entries[3].source).toBe('UsersService');
  });

  it('calling initLogger() twice keeps the first instance unless forced', async () => {
    const first = initLogger({ dir, console: false });
    const second = initLogger({ dir, console: false, level: 'error' });
    expect(second).toBe(first);

    const third = initLogger({ dir, console: false, level: 'error', force: true });
    expect(third).not.toBe(first);
    expect(getLogger()).toBe(third);
    expect(log.info('dropped')).toBeUndefined();
    await first.close();
  });

  it('log works before initLogger() and switches to the configured logger afterwards', async () => {
    // simulate a module that logs at import time, before app.ts ran initLogger()
    const early = getLogger();
    expect(isLoggerInitialized()).toBe(false);
    expect(early.store.dir.endsWith('logs')).toBe(true);

    const configured = initLogger({ dir, console: false });
    expect(configured).not.toBe(early);
    log.info('after init');
    await log.flush();
    const entries = await configured.reader.readAll(toDateKey());
    expect(entries.map((e) => e.message)).toEqual(['after init']);
  });

  it('setLogger() adopts an existing instance and createLogViewer() defaults to it', async () => {
    const custom = createLogger({ dir, console: false, source: 'custom' });
    setLogger(custom);
    expect(isLoggerInitialized()).toBe(true);
    log.info('hello');
    await log.flush();

    const handler = createLogViewer({ basePath: '/logs' });
    const server = http.createServer(handler);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const port = (server.address() as AddressInfo).port;
      const meta = (await (await fetch(`http://127.0.0.1:${port}/logs/api/meta`)).json()) as { dir: string };
      expect(meta.dir).toBe(dir);
      const logs = (await (await fetch(`http://127.0.0.1:${port}/logs/api/logs?date=${toDateKey()}`)).json()) as {
        entries: Array<{ message: string; source?: string }>;
      };
      expect(logs.entries[0]).toMatchObject({ message: 'hello', source: 'custom' });
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
