import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export type AuthOptions =
  | {
      type: 'basic';
      username: string;
      password: string;
      /** Realm shown in the browser prompt. Default `node-log-viewer`. */
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

/** Returns true when the request may proceed; otherwise writes a 401 response and returns false. */
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
    res.statusCode = 401;
    res.setHeader('www-authenticate', `Basic realm="${(auth.realm ?? 'node-log-viewer').replace(/"/g, '')}", charset="UTF-8"`);
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Unauthorized');
    return false;
  }

  let ok = false;
  try {
    ok = await auth.authorize(req);
  } catch {
    ok = false;
  }
  if (ok) return true;
  res.statusCode = 401;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end('Unauthorized');
  return false;
}
