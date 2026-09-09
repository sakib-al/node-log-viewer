import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '../core/logger.js';
import { LOG_LEVELS, isLogLevel } from '../core/types.js';
import { isDateKey } from '../core/utils.js';
import type { LogViewerPlugin, PluginConfig } from '../plugins/plugin.js';
import { HttpError, readJsonBody, sendJson } from './http.js';

export interface ApiContext {
  logger: Logger;
  title: string;
  version: string;
  base: string;
  /** Allow deleting log files from the UI. Default true. */
  allowDelete: boolean;
  /** Allow editing plugin settings from the UI. Default true. */
  allowPluginConfig: boolean;
}

/** Shape returned by GET /api/plugins for one plugin. Secrets are never sent to the client. */
export interface PluginView {
  name: string;
  title: string;
  description?: string;
  enabled: boolean;
  minLevel?: string;
  configurable: boolean;
  testable: boolean;
  settingsSchema: LogViewerPlugin['settingsSchema'];
  config: PluginConfig;
  /** Names of password fields that currently hold a value (the value itself is withheld). */
  secretsSet: string[];
}

export function pluginView(plugin: LogViewerPlugin): PluginView {
  const schema = plugin.settingsSchema ?? [];
  const raw = plugin.getConfig?.() ?? {};
  const config: PluginConfig = {};
  const secretsSet: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const field = schema.find((f) => f.key === key);
    if (field && field.type === 'password') {
      if (typeof value === 'string' && value) secretsSet.push(key);
      config[key] = '';
    } else {
      config[key] = value;
    }
  }
  return {
    name: plugin.name,
    title: plugin.title ?? plugin.name,
    description: plugin.description,
    enabled: plugin.enabled !== false,
    minLevel: plugin.minLevel,
    configurable: typeof plugin.configure === 'function',
    testable: typeof plugin.test === 'function',
    settingsSchema: schema,
    config,
    secretsSet,
  };
}

/**
 * Routes `/api/*` requests. Returns false when the path is not an API route.
 * Throws HttpError for client errors.
 */
export async function handleApi(ctx: ApiContext, req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams): Promise<boolean> {
  if (!path.startsWith('/api/')) return false;
  const method = (req.method ?? 'GET').toUpperCase();
  const route = path.slice(4); // strip "/api"
  const { logger } = ctx;

  if (method === 'GET' && route === '/meta') {
    sendJson(res, 200, {
      title: ctx.title,
      version: ctx.version,
      base: ctx.base,
      levels: LOG_LEVELS,
      dir: logger.store.dir,
      allowDelete: ctx.allowDelete,
      allowPluginConfig: ctx.allowPluginConfig,
      now: new Date().toISOString(),
    });
    return true;
  }

  if (method === 'GET' && route === '/dates') {
    await logger.store.flush();
    sendJson(res, 200, { dates: await logger.reader.listDates() });
    return true;
  }

  if (method === 'GET' && route === '/logs') {
    const date = query.get('date') ?? '';
    if (!isDateKey(date)) throw new HttpError(400, 'Query parameter "date" must be YYYY-MM-DD');
    const levelParam = query.get('level') ?? 'all';
    const level = levelParam === 'all' ? 'all' : isLogLevel(levelParam) ? levelParam : undefined;
    if (!level) throw new HttpError(400, `Invalid level "${levelParam}"`);
    const order = query.get('order') === 'asc' ? 'asc' : 'desc';
    await logger.store.flush();
    const result = await logger.reader.read({
      date,
      level,
      search: query.get('search') ?? undefined,
      page: numberParam(query.get('page')),
      pageSize: numberParam(query.get('pageSize')),
      order,
    });
    sendJson(res, 200, result);
    return true;
  }

  const dateMatch = route.match(/^\/dates\/(\d{4}-\d{2}-\d{2})$/);
  if (dateMatch && method === 'DELETE') {
    if (!ctx.allowDelete) throw new HttpError(403, 'Deleting log files is disabled');
    const deleted = await logger.store.delete(dateMatch[1]);
    sendJson(res, 200, { deleted });
    return true;
  }

  if (method === 'GET' && route === '/plugins') {
    await logger.ready();
    sendJson(res, 200, { plugins: logger.plugins.list().map(pluginView) });
    return true;
  }

  const pluginMatch = route.match(/^\/plugins\/([a-z0-9_-]+)(\/test)?$/i);
  if (pluginMatch) {
    const plugin = logger.plugins.get(pluginMatch[1]);
    if (!plugin) throw new HttpError(404, `Unknown plugin "${pluginMatch[1]}"`);
    await logger.ready();

    if (pluginMatch[2] && method === 'POST') {
      if (typeof plugin.test !== 'function') throw new HttpError(400, `Plugin "${plugin.name}" does not support test messages`);
      try {
        await plugin.test();
      } catch (err) {
        throw new HttpError(502, err instanceof Error ? err.message : String(err));
      }
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (!pluginMatch[2] && method === 'GET') {
      sendJson(res, 200, { plugin: pluginView(plugin) });
      return true;
    }

    if (!pluginMatch[2] && (method === 'PUT' || method === 'POST')) {
      if (!ctx.allowPluginConfig) throw new HttpError(403, 'Editing plugin settings is disabled');
      if (typeof plugin.configure !== 'function') throw new HttpError(400, `Plugin "${plugin.name}" is not configurable`);
      const body = await readJsonBody<PluginConfig>(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Body must be a JSON object');

      // Blank password fields mean "keep the existing secret".
      const current = plugin.getConfig?.() ?? {};
      const merged: PluginConfig = { ...body };
      for (const field of plugin.settingsSchema ?? []) {
        if (field.type === 'password' && (merged[field.key] === '' || merged[field.key] === undefined)) {
          merged[field.key] = current[field.key];
        }
      }
      try {
        await plugin.configure(merged);
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      await logger.settings.setPluginConfig(plugin.name, plugin.getConfig?.() ?? merged);
      sendJson(res, 200, { plugin: pluginView(plugin) });
      return true;
    }
  }

  throw new HttpError(404, `No API route for ${method} ${path}`);
}

function numberParam(value: string | null): number | undefined {
  if (value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
