import type { IncomingMessage, ServerResponse } from 'node:http';

export type NodeHandler = (req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void) => void;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-length', Buffer.byteLength(payload));
  res.end(payload);
}

export function sendText(res: ServerResponse, status: number, text: string, contentType = 'text/plain; charset=utf-8'): void {
  res.statusCode = status;
  res.setHeader('content-type', contentType);
  res.setHeader('content-length', Buffer.byteLength(text));
  res.end(text);
}

const MAX_BODY = 256 * 1024;

export function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    // Express (or another body parser) may already have parsed the body.
    const pre = (req as IncomingMessage & { body?: unknown }).body;
    if (pre !== undefined && typeof pre === 'object') {
      resolve(pre as T);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({} as T);
        return;
      }
      try {
        resolve(JSON.parse(raw) as T);
      } catch {
        reject(new HttpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Determines the path of `req` relative to where the viewer is mounted.
 * Works for Express sub-apps (`req.baseUrl`), Nest/Express middleware (`originalUrl`), and raw `http`.
 */
export function resolveRequest(req: IncomingMessage, configuredBase: string | undefined): { base: string; path: string; query: URLSearchParams } {
  const r = req as IncomingMessage & { baseUrl?: string; originalUrl?: string };
  const rawUrl = req.url ?? '/';
  const full = new URL(r.originalUrl ?? rawUrl, 'http://localhost');
  const fullPath = full.pathname;

  let base: string;
  if (typeof r.baseUrl === 'string' && r.baseUrl) {
    base = r.baseUrl;
  } else if (configuredBase !== undefined) {
    base = configuredBase;
  } else if (r.originalUrl && r.originalUrl !== rawUrl) {
    // mounted without baseUrl (e.g. Nest's MiddlewareConsumer): base = originalUrl minus url
    const rel = new URL(rawUrl, 'http://localhost').pathname;
    base = fullPath.endsWith(rel) ? fullPath.slice(0, fullPath.length - rel.length) : '';
  } else {
    base = '';
  }
  base = normalizeBase(base);

  let rel = fullPath;
  if (base && (fullPath === base || fullPath.startsWith(`${base}/`))) {
    rel = fullPath.slice(base.length) || '/';
  } else if (base && !fullPath.startsWith(base)) {
    // request url already relative (Express strips the mount path)
    rel = new URL(rawUrl, 'http://localhost').pathname;
  }
  if (!rel.startsWith('/')) rel = `/${rel}`;
  return { base, path: rel, query: full.searchParams };
}

export function normalizeBase(base: string): string {
  if (!base || base === '/') return '';
  let b = base.startsWith('/') ? base : `/${base}`;
  b = b.replace(/\/+$/, '');
  return b;
}
