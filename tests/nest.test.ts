import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { Controller, Get, Inject, Module, NotFoundException, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOG_VIEWER_OPTIONS, LogViewerExceptionFilter, LogViewerLogger, LogViewerModule, Logger, createLogger } from '../src/nest.js';
import { toDateKey } from '../src/core/utils.js';
import { rm, tmpDir } from './helpers.js';

let dir: string;
let app: INestApplication | undefined;

beforeEach(async () => {
  dir = await tmpDir();
});
afterEach(async () => {
  if (app) {
    await app.get(Logger).close();
    await app.close();
  }
  app = undefined;
  await rm(dir);
});

@Controller()
class TestController {
  constructor(@Inject(Logger) private readonly logger: Logger) {}

  @Get('ok')
  ok() {
    this.logger.child({ source: 'TestController' }).info('ok called');
    return { ok: true };
  }

  @Get('missing')
  missing() {
    throw new NotFoundException('nothing here');
  }

  @Get('boom')
  boom() {
    throw new Error('unhandled boom');
  }
}

async function boot(options: Parameters<typeof LogViewerModule.forRoot>[0], useLogger = true) {
  @Module({ imports: [LogViewerModule.forRoot({ dir, console: false, ...options })], controllers: [TestController] })
  class AppModule {}

  app = await NestFactory.create(AppModule, { logger: false, bufferLogs: true });
  if (useLogger) app.useLogger(app.get(LogViewerLogger));
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, logger: app.get(Logger) };
}

describe('LogViewerModule (Express adapter)', () => {
  it('mounts the viewer sub-tree and records controller logs', async () => {
    const { base, logger } = await boot({ path: '/logs', title: 'Nest logs' });

    expect((await (await fetch(`${base}/ok`)).json())).toEqual({ ok: true });
    await logger.flush();

    const meta = (await (await fetch(`${base}/logs/api/meta`)).json()) as { title: string; base: string };
    expect(meta).toMatchObject({ title: 'Nest logs', base: '/logs' });

    const html = await (await fetch(`${base}/logs`)).text();
    expect(html).toContain('<html');

    const dates = (await (await fetch(`${base}/logs/api/dates`)).json()) as { dates: Array<{ date: string }> };
    expect(dates.dates[0].date).toBe(toDateKey());

    const logs = (await (await fetch(`${base}/logs/api/logs?date=${toDateKey()}&search=ok%20called`)).json()) as {
      entries: Array<{ source?: string; message: string }>;
    };
    expect(logs.entries[0]).toMatchObject({ source: 'TestController', message: 'ok called' });

    // routes outside the mount are untouched
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it('records unhandled exceptions once, with request context, and keeps Nest responses intact', async () => {
    const { base, logger } = await boot({ path: '/logs' });

    const boom = await fetch(`${base}/boom`);
    expect(boom.status).toBe(500);
    expect(await boom.json()).toEqual({ statusCode: 500, message: 'Internal server error' });

    const missing = await fetch(`${base}/missing`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { message: string }).message).toBe('nothing here');

    await logger.flush();
    const entries = await logger.reader.readAll(toDateKey());
    const errors = entries.filter((e) => e.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      source: 'ExceptionFilter',
      message: 'Error: unhandled boom',
      context: { status: 500, method: 'GET', url: '/boom' },
    });
    expect(errors[0].error?.stack).toContain('unhandled boom');
    // 4xx are not recorded by default
    expect(entries.some((e) => e.message.includes('nothing here'))).toBe(false);
  });

  it('can record 4xx as warnings and can disable the filter and the UI', async () => {
    const { base, logger } = await boot({ path: false, logClientErrors: true });
    expect((await fetch(`${base}/logs/api/meta`)).status).toBe(404);
    await fetch(`${base}/missing`);
    await logger.flush();
    const entries = await logger.reader.readAll(toDateKey());
    expect(entries.find((e) => e.message === 'nothing here')).toMatchObject({ level: 'warn', context: { status: 404, url: '/missing' } });
    await logger.close();
    await app!.close();
    app = undefined;

    const second = await boot({ path: '/logs', catchExceptions: false });
    await fetch(`${second.base}/boom`);
    await second.logger.flush();
    const after = await second.logger.reader.readAll(toDateKey());
    // Nest's own ExceptionsHandler still logs through useLogger, but our filter is not involved
    const boomEntries = after.filter((e) => e.message.includes('unhandled boom'));
    expect(boomEntries.length).toBeGreaterThan(0);
    expect(boomEntries.some((e) => e.source === 'ExceptionFilter')).toBe(false);
    expect(boomEntries.some((e) => e.source === 'ExceptionsHandler')).toBe(true);
  });

  it('LogViewerLogger maps Nest logger calls to entries', async () => {
    const { logger } = await boot({ path: false });
    const nestLogger = app!.get(LogViewerLogger);
    nestLogger.log('plain', 'MyContext');
    nestLogger.warn('careful', { extra: 1 }, 'Ctx2');
    nestLogger.error('failed', 'Error: failed\n    at somewhere (file.js:1:1)', 'ErrCtx');
    nestLogger.error(new RangeError('range'), undefined, 'ErrCtx');
    nestLogger.verbose('v');
    nestLogger.fatal('f');
    nestLogger.debug({ structured: true });
    await logger.flush();

    const entries = (await logger.reader.readAll(toDateKey())).filter((e) => !['NestFactory', 'InstanceLoader', 'RoutesResolver', 'RouterExplorer', 'NestApplication'].includes(e.source ?? ''));
    expect(entries.map((e) => [e.level, e.source, e.message])).toEqual([
      ['info', 'MyContext', 'plain'],
      ['warn', 'Ctx2', 'careful'],
      ['error', 'ErrCtx', 'failed'],
      ['error', 'ErrCtx', 'RangeError: range'],
      ['debug', undefined, 'v'],
      ['error', undefined, 'f'],
      ['debug', undefined, '{"structured":true}'],
    ]);
    expect(entries[1].context).toEqual({ extra: 1 });
    expect(entries[2].error?.stack).toContain('at somewhere');
    expect(entries[3].error?.name).toBe('RangeError');
  });

  it('exposes options and reuses an injected logger', async () => {
    const { logger } = await boot({ path: false, title: 'X' });
    const options = app!.get<{ title: string }>(LOG_VIEWER_OPTIONS);
    expect(options.title).toBe('X');
    expect(logger.store.dir).toBe(dir);
  });
});

describe('LogViewerExceptionFilter without an injected HttpAdapterHost (duplicate @nestjs/core)', () => {
  // Simulates a `file:`/`npm link` install where the app's HttpAdapterHost token differs from ours:
  // Nest injects nothing, and HttpExceptions come from a different @nestjs/common copy.
  function fakeHost(res: Record<string, unknown>) {
    return {
      getType: () => 'http',
      getArgByIndex: (i: number) => (i === 1 ? res : undefined),
      switchToHttp: () => ({ getRequest: () => ({ method: 'GET', url: '/x' }), getResponse: () => res }),
    } as never;
  }
  function expressRes() {
    const calls: Array<[number, unknown]> = [];
    let code = 200;
    const res: Record<string, unknown> = {
      headersSent: false,
      status(c: number) {
        code = c;
        return res;
      },
      json(body: unknown) {
        calls.push([code, body]);
      },
    };
    return { res, calls };
  }
  // "foreign" HttpException: right shape, wrong prototype chain
  class ForeignHttpException extends Error {
    constructor(private readonly status: number, private readonly body: string | object) {
      super(typeof body === 'string' ? body : 'http error');
    }
    getStatus() { return this.status; }
    getResponse() { return this.body; }
  }

  it('replies directly on the response and still records the exception', async () => {
    const logger = createLogger({ dir, console: false });
    const filter = new LogViewerExceptionFilter(logger, { logClientErrors: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const a = expressRes();
    filter.catch(new ForeignHttpException(404, { statusCode: 404, message: 'nothing here' }), fakeHost(a.res));
    expect(a.calls).toEqual([[404, { statusCode: 404, message: 'nothing here' }]]);

    const b = expressRes();
    filter.catch(new Error('kaboom'), fakeHost(b.res));
    expect(b.calls).toEqual([[500, { statusCode: 500, message: 'Internal server error' }]]);

    const c = expressRes();
    c.res.headersSent = true;
    c.res.end = vi.fn();
    filter.catch(new Error('late'), fakeHost(c.res));
    expect(c.res.end).toHaveBeenCalledOnce();

    expect(warn).toHaveBeenCalledTimes(1); // duplicate-Nest hint printed once
    expect(warn.mock.calls[0][0]).toMatch(/two copies of @nestjs\/core/);
    warn.mockRestore();

    await logger.flush();
    const entries = await logger.reader.readAll(toDateKey());
    expect(entries.map((e) => [e.level, e.message, e.context?.status])).toEqual([
      ['warn', 'http error', 404],
      ['error', 'Error: kaboom', 500],
      ['error', 'Error: late', 500],
    ]);
    await logger.close();
  });

  it('answers foreign HttpExceptions through the adapter when one is available', () => {
    const logger = createLogger({ dir, console: false });
    const reply = vi.fn();
    const filter = new LogViewerExceptionFilter(logger, {});
    (filter as unknown as { applicationRef: unknown }).applicationRef = { isHeadersSent: () => false, reply, end: vi.fn() };

    const res = {};
    filter.catch(new ForeignHttpException(403, 'nope'), fakeHost(res));
    expect(reply).toHaveBeenCalledWith(res, { statusCode: 403, message: 'nope' }, 403);
  });
});
