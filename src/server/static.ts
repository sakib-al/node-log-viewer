import { existsSync, promises as fs } from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendText } from './http.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

/** Locates the pre-built UI directory shipped in the package (or an explicit override). */
export function resolveUiDir(override?: string): string | null {
  if (override) return existsSync(override) ? path.resolve(override) : null;
  const here = moduleDir();
  const candidates = [
    path.join(here, 'ui'), // dist/index.cjs -> dist/ui
    path.join(here, '..', 'dist', 'ui'),
    path.join(here, '..', '..', 'dist', 'ui'), // src/server -> dist/ui (dev / tests)
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, 'index.html'))) return c;
  }
  return null;
}

function moduleDir(): string {
  // CJS build: real __dirname. ESM build: tsup shim. Source (vitest): import.meta.url.
  if (typeof __dirname === 'string') return __dirname;
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

export class StaticUi {
  private indexCache = new Map<string, string>();

  constructor(
    readonly dir: string | null,
    private readonly title: string,
  ) {}

  get available(): boolean {
    return this.dir !== null;
  }

  /** Serves index.html with the mount path injected so the SPA can call the API and load assets. */
  async serveIndex(res: ServerResponse, base: string): Promise<void> {
    if (!this.dir) {
      sendText(res, 200, missingUiPage(this.title), 'text/html; charset=utf-8');
      return;
    }
    let html = this.indexCache.get(base);
    if (!html) {
      const raw = await fs.readFile(path.join(this.dir, 'index.html'), 'utf8');
      const prefix = base || '';
      html = raw
        // Vite emits absolute asset URLs (/assets/...) -> prefix them with the mount path
        .replace(/(src|href)="\/(?!\/)/g, `$1="${prefix}/`)
        .replace(
          '<head>',
          `<head><script>window.__LOG_VIEWER__=${JSON.stringify({ base: prefix, title: this.title })};</script>`,
        );
      this.indexCache.set(base, html);
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(html);
  }

  /** Serves a file under the UI directory. Returns false when it does not exist. */
  async serveAsset(res: ServerResponse, relPath: string): Promise<boolean> {
    if (!this.dir) return false;
    const safe = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
    const file = path.join(this.dir, safe);
    if (!file.startsWith(this.dir)) return false;
    let data: Buffer;
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) return false;
      data = await fs.readFile(file);
    } catch {
      return false;
    }
    const ext = path.extname(file).toLowerCase();
    res.statusCode = 200;
    res.setHeader('content-type', MIME[ext] ?? 'application/octet-stream');
    res.setHeader('content-length', data.length);
    // hashed assets are immutable; everything else short-lived
    res.setHeader('cache-control', /\.[a-f0-9]{8,}\./i.test(path.basename(file)) ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.end(data);
    return true;
  }
}

function missingUiPage(title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:4rem auto;padding:0 1rem;color:#222}code{background:#eee;padding:.1rem .3rem;border-radius:4px}</style></head>
<body><h1>${title}</h1><p>The web UI assets were not found. If you are running from source, build them first:</p>
<pre><code>pnpm build</code></pre><p>The JSON API is still available under <code>./api/*</code>.</p></body></html>`;
}
