import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function tmpDir(prefix = 'nlv-test-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function rm(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

/** Minimal fetch stub that records calls and replies with the queued responses. */
export function fakeFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }> = []) {
  const calls: Array<{ url: string; init: RequestInit; json: unknown }> = [];
  const queue = [...responses];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const next = queue.shift() ?? { status: 204 };
    let json: unknown = undefined;
    try {
      json = init?.body ? JSON.parse(String(init.body)) : undefined;
    } catch {
      json = init?.body;
    }
    calls.push({ url: String(url), init: init ?? {}, json });
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json', ...(next.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}
