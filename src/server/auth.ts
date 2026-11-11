import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { sendJson } from './http.js';

export type AuthOptions =
  | {
      type: 'basic';
      username: string;
      password: string;
      /** Realm label (shown on the login page). Default `node-log-viewer`. */
      realm?: string;
    }
  | {
      type: 'custom';
      /** Return true to allow the request. Return false (or throw) to deny with 401. */
      authorize: (req: IncomingMessage) => boolean | Promise<boolean>;
    };

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Returns true when the request may proceed; otherwise writes a 401 JSON response and returns false.
 *
 * Intentionally does **not** send `WWW-Authenticate` for basic auth — that header triggers the
 * browser's native credential dialog. The SPA login page collects credentials instead and sends
 * an `Authorization: Basic …` header on API calls.
 */
export async function checkAuth(auth: AuthOptions | undefined, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (!auth) return true;

  if (auth.type === 'basic') {
    const header = req.headers.authorization ?? '';
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      const user = idx >= 0 ? decoded.slice(0, idx) : decoded;
      const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
      if (safeEqual(user, auth.username) && safeEqual(pass, auth.password)) return true;
    }
    sendJson(res, 401, {
      error: 'Unauthorized',
      authRequired: true,
      authType: 'basic',
      realm: auth.realm ?? 'node-log-viewer',
    });
    return false;
  }

  let ok = false;
  try {
    ok = await auth.authorize(req);
  } catch {
    ok = false;
  }
  if (ok) return true;
  sendJson(res, 401, {
    error: 'Unauthorized',
    authRequired: true,
    authType: 'custom',
  });
  return false;
}
