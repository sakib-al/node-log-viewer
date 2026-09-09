import type { IncomingMessage, ServerResponse } from 'node:http';
import { getLogger } from '../core/global.js';
import type { Logger } from '../core/logger.js';
import { VERSION } from '../version.js';
import { handleApi } from './api.js';
import { checkAuth, type AuthOptions } from './auth.js';
import { HttpError, resolveRequest, sendJson, type NodeHandler } from './http.js';
import { StaticUi, resolveUiDir } from './static.js';

export interface LogViewerOptions {
  /** The logger whose files should be displayed. Defaults to the global logger (`initLogger()` / `log`). */
  logger?: Logger;
  /**
   * Path the viewer is mounted at. Auto-detected for Express/Nest middleware;
   * required for a raw `http.createServer` when not serving from `/`.
   */
  basePath?: string;
  /** Optional authentication. Off by default. */
  auth?: AuthOptions;
  /** Title shown in the UI. Default `Log Viewer`. */
  title?: string;
  /** Allow deleting log files from the UI. Default true. */
  allowDelete?: boolean;
  /** Allow editing plugin settings from the UI. Default true. */
  allowPluginConfig?: boolean;
  /** Override the directory containing the built UI (advanced). */
  uiDir?: string;
}

export interface LogViewerHandler extends NodeHandler {
  /** Absolute directory the UI assets are served from, or null when not built. */
  readonly uiDir: string | null;
}

/**
 * Creates a Node HTTP handler that serves the log viewer UI and its JSON API.
 *
 * @example Express
 *   app.use('/logs', createLogViewer({ logger }));
 * @example raw http
 *   http.createServer(createLogViewer({ logger, basePath: '/' })).listen(4000);
 */
export function createLogViewer(options: LogViewerOptions = {}): LogViewerHandler {
  const logger = options.logger ?? getLogger();
  if (!logger || typeof logger.log !== 'function') {
    throw new Error('createLogViewer({ logger }) requires a Logger created with createLogger()');
  }
  const title = options.title ?? 'Log Viewer';
  const staticUi = new StaticUi(resolveUiDir(options.uiDir), title);
  const allowDelete = options.allowDelete ?? true;
  const allowPluginConfig = options.allowPluginConfig ?? true;

  const handler = async (req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void): Promise<void> => {
    const { base, path, query } = resolveRequest(req, options.basePath);
    try {
      if (!(await checkAuth(options.auth, req, res))) return;

      const handled = await handleApi(
        { logger, title, version: VERSION, base, allowDelete, allowPluginConfig },
        req,
        res,
        path,
        query,
      );
      if (handled) return;

      const method = (req.method ?? 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        throw new HttpError(405, 'Method not allowed');
      }

      // Static assets (anything with a file extension); SPA fallback for everything else.
      if (/\.[a-z0-9]+$/i.test(path) && path !== '/index.html') {
        if (await staticUi.serveAsset(res, path)) return;
        if (next) return next();
        throw new HttpError(404, 'Not found');
      }
      await staticUi.serveIndex(res, base);
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Log viewer request failed', { path, error: err });
      sendJson(res, 500, { error: message });
    }
  };

  const wrapped: NodeHandler = (req, res, next) => {
    void handler(req, res, next);
  };
  Object.defineProperty(wrapped, 'uiDir', { value: staticUi.dir, enumerable: true });
  return wrapped as LogViewerHandler;
}
