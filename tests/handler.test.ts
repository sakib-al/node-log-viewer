import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogViewer, createLogger, discordPlugin, type Logger, type NodeHandler } from '../src/index.js';
import { toDateKey } from '../src/core/utils.js';
import { fakeFetch, rm, tmpDir } from './helpers.js';

const WEBHOOK = 'https://discord.com/api/webhooks/42/EXAMPLE';

let dir: string;
let logger: Logger;
let servers: http.Server[] = [];

beforeEach(async () => {
  dir = await tmpDir();
  logger = createLogger({ dir, console: false });
});
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers = [];
  await rm(dir);
});

async function listen(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Simulates Express `app.use('/mount', handler)`: strips the prefix, sets baseUrl/originalUrl. */
function expressMount(mount: string, handler: NodeHandler): http.RequestListener {
  return (req, res) => {
    const url = req.url ?? '/';
    if (url === mount || url.startsWith(`${mount}/`) || url.startsWith(`${mount}?`)) {
      const r = req as IncomingMessage & { baseUrl?: string; originalUrl?: string };
      r.originalUrl = url;
      r.baseUrl = mount;
      req.url = url.slice(mount.length) || '/';
      handler(req, res, () => {
        res.statusCode = 404;
        res.end('express 404');
      });
      return;
    }
    res.statusCode = 404;
    res.end('app 404');
  };
}

const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as any });

describe('createLogViewer handler', () => {
  it('serves the JSON API under a raw http server with basePath', async () => {
    logger.info('hello', { a: 1 });
    logger.error('bad', new Error('kaboom'));
    await logger.flush();
    const base = `${await listen(createLogViewer({ logger, basePath: '/logs', title: 'T' }))}/logs`;

    const meta = await json(await fetch(`${base}/api/meta`));
    expect(meta.status).toBe(200);
    expect(meta.body).toMatchObject({ title: 'T', base: '/logs', allowDelete: true, dir });

    const dates = await json(await fetch(`${base}/api/dates`));
    expect(dates.body.dates).toHaveLength(1);
    expect(dates.body.dates[0]).toMatchObject({ date: toDateKey(), count: 2 });

    const logs = await json(await fetch(`${base}/api/logs?date=${toDateKey()}&level=error`));
    expect(logs.body.total).toBe(1);
    expect(logs.body.entries[0].error.message).toBe('kaboom');
    expect(logs.body.counts.all).toBe(2);

    expect((await json(await fetch(`${base}/api/logs`))).status).toBe(400);
    expect((await json(await fetch(`${base}/api/logs?date=2026-01-01&level=nope`))).status).toBe(400);
    expect((await json(await fetch(`${base}/api/nothing`))).status).toBe(404);
    expect((await fetch(`${base}/api/dates`, { method: 'POST' })).status).toBe(404);
  });

  it('works when mounted Express-style (baseUrl + stripped url)', async () => {
    logger.warn('w');
    await logger.flush();
    const root = await listen(expressMount('/admin/logs', createLogViewer({ logger })));

    const dates = await json(await fetch(`${root}/admin/logs/api/dates`));
    expect(dates.status).toBe(200);
    expect(dates.body.dates[0].count).toBe(1);

    const meta = await json(await fetch(`${root}/admin/logs/api/meta`));
    expect(meta.body.base).toBe('/admin/logs');

    const html = await (await fetch(`${root}/admin/logs`)).text();
    expect(html).toContain('<html');
    // either the built UI (with injected base) or the fallback page
    expect(html.includes('"base":"/admin/logs"') || html.includes('not found')).toBe(true);

    expect((await fetch(`${root}/elsewhere`)).status).toBe(404);
  });

  it('deletes files and can be told not to', async () => {
    logger.info('x');
    await logger.flush();
    const base = `${await listen(createLogViewer({ logger, basePath: '/l' }))}/l`;
    const del = await json(await fetch(`${base}/api/dates/${toDateKey()}`, { method: 'DELETE' }));
    expect(del.body).toEqual({ deleted: true });
    expect(await logger.store.listDates()).toEqual([]);

    const base2 = `${await listen(createLogViewer({ logger, basePath: '/l', allowDelete: false }))}/l`;
    expect((await fetch(`${base2}/api/dates/${toDateKey()}`, { method: 'DELETE' })).status).toBe(403);
    expect((await fetch(`${base2}/api/dates/..%2F..%2Fetc`, { method: 'DELETE' })).status).toBe(404);
  });

  it('enforces basic auth when configured', async () => {
    const base = `${await listen(createLogViewer({ logger, basePath: '/l', auth: { type: 'basic', username: 'admin', password: 's3cret' } }))}/l`;
    const denied = await fetch(`${base}/api/meta`);
    expect(denied.status).toBe(401);
    expect(denied.headers.get('www-authenticate')).toContain('Basic');

    const wrong = await fetch(`${base}/api/meta`, { headers: { authorization: `Basic ${Buffer.from('admin:nope').toString('base64')}` } });
    expect(wrong.status).toBe(401);

    const ok = await fetch(`${base}/api/meta`, { headers: { authorization: `Basic ${Buffer.from('admin:s3cret').toString('base64')}` } });
    expect(ok.status).toBe(200);
  });

  it('supports a custom authorize hook', async () => {
    const base = `${await listen(
      createLogViewer({ logger, basePath: '/l', auth: { type: 'custom', authorize: (req) => req.headers['x-token'] === 'yes' } }),
    )}/l`;
    expect((await fetch(`${base}/api/meta`)).status).toBe(401);
    expect((await fetch(`${base}/api/meta`, { headers: { 'x-token': 'yes' } })).status).toBe(200);
  });

  it('exposes plugins, masks secrets, saves + persists config, keeps blank secrets, and runs tests', async () => {
    const { fetch: f, calls } = fakeFetch([{ status: 204 }]);
    logger.use(discordPlugin({ fetch: f }));
    const base = `${await listen(createLogViewer({ logger, basePath: '/l' }))}/l`;

    let list = await json(await fetch(`${base}/api/plugins`));
    expect(list.body.plugins).toHaveLength(1);
    expect(list.body.plugins[0]).toMatchObject({ name: 'discord', enabled: false, configurable: true, testable: true, secretsSet: [] });
    expect(list.body.plugins[0].settingsSchema.some((f: { key: string }) => f.key === 'webhookUrl')).toBe(true);

    // invalid config -> 400 and nothing persisted
    const bad = await json(
      await fetch(`${base}/api/plugins/discord`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, webhookUrl: 'nope' }) }),
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/webhook URL/i);

    // valid config -> saved, secret masked in the response
    const saved = await json(
      await fetch(`${base}/api/plugins/discord`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true, webhookUrl: WEBHOOK, minLevel: 'warn', appName: 'svc' }),
      }),
    );
    expect(saved.status).toBe(200);
    expect(saved.body.plugin.enabled).toBe(true);
    expect(saved.body.plugin.config.webhookUrl).toBe('');
    expect(saved.body.plugin.secretsSet).toEqual(['webhookUrl']);
    expect(saved.body.plugin.config.appName).toBe('svc');

    const persisted = JSON.parse(await fs.readFile(path.join(dir, '.log-viewer.json'), 'utf8'));
    expect(persisted.plugins.discord).toMatchObject({ enabled: true, webhookUrl: WEBHOOK, minLevel: 'warn' });

    // blank password field keeps the stored secret
    const kept = await json(
      await fetch(`${base}/api/plugins/discord`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true, webhookUrl: '', minLevel: 'error' }),
      }),
    );
    expect(kept.body.plugin.secretsSet).toEqual(['webhookUrl']);
    expect(kept.body.plugin.minLevel).toBe('error');

    // test message goes through the plugin's fetch
    const test = await json(await fetch(`${base}/api/plugins/discord/test`, { method: 'POST' }));
    expect(test.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(WEBHOOK);

    // unknown plugin
    expect((await fetch(`${base}/api/plugins/slack`)).status).toBe(404);

    // settings editing can be disabled
    const ro = `${await listen(createLogViewer({ logger, basePath: '/l', allowPluginConfig: false }))}/l`;
    expect((await fetch(`${ro}/api/plugins/discord`, { method: 'PUT', body: '{}' })).status).toBe(403);
    list = await json(await fetch(`${ro}/api/plugins`));
    expect(list.status).toBe(200);
  });

  it('a fresh logger re-applies settings saved through the UI', async () => {
    const { fetch: f } = fakeFetch();
    logger.use(discordPlugin({ fetch: f }));
    const base = `${await listen(createLogViewer({ logger, basePath: '/l' }))}/l`;
    await fetch(`${base}/api/plugins/discord`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, webhookUrl: WEBHOOK, minLevel: 'info' }),
    });

    const plugin = discordPlugin({ fetch: f });
    const restarted = createLogger({ dir, console: false, plugins: [plugin] });
    await restarted.ready();
    expect(plugin.enabled).toBe(true);
    expect(plugin.minLevel).toBe('info');
    expect(plugin.getConfig().webhookUrl).toBe(WEBHOOK);
  });

  it('rejects non-GET requests to non-API paths and serves assets or 404', async () => {
    const base = `${await listen(createLogViewer({ logger, basePath: '/l' }))}/l`;
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
    const index = await fetch(`${base}/some/spa/route`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
  });
});

describe('server helpers', () => {
  it('sends 500 JSON when the logger read fails unexpectedly', async () => {
    const broken = createLogger({ dir, console: false });
    (broken.reader as unknown as { listDates: () => Promise<never> }).listDates = async () => {
      throw new Error('disk on fire');
    };
    const base = `${await listen(createLogViewer({ logger: broken, basePath: '/l' }))}/l`;
    const res = await json(await fetch(`${base}/api/dates`));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('disk on fire');
  });

  it('createLogViewer validates its input', () => {
    expect(() => createLogViewer({ logger: {} as never })).toThrow(/requires a Logger/);
    // no logger -> falls back to the global one
    expect(typeof createLogViewer({})).toBe('function');
  });

  it('handler type is a plain node request listener', async () => {
    const h = createLogViewer({ logger, basePath: '/' });
    const base = await listen(h as unknown as (req: IncomingMessage, res: ServerResponse) => void);
    expect((await fetch(`${base}/api/meta`)).status).toBe(200);
  });
});
