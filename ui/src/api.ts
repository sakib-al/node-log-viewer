import type { DateFileInfo, LevelFilter, Meta, PluginView, ReadResult } from './types';

declare global {
  interface Window {
    __LOG_VIEWER__?: { base: string; title: string };
  }
}

export const BASE = window.__LOG_VIEWER__?.base ?? '';
export const INITIAL_TITLE = window.__LOG_VIEWER__?.title ?? 'Log Viewer';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg);
  }
  return body as T;
}

export const api = {
  meta: () => request<Meta>('/meta'),
  dates: () => request<{ dates: DateFileInfo[] }>('/dates').then((r) => r.dates),
  logs: (params: { date: string; level: LevelFilter; search: string; page: number; pageSize: number; order: 'asc' | 'desc' }) => {
    const q = new URLSearchParams({
      date: params.date,
      level: params.level,
      page: String(params.page),
      pageSize: String(params.pageSize),
      order: params.order,
    });
    if (params.search) q.set('search', params.search);
    return request<ReadResult>(`/logs?${q.toString()}`);
  },
  deleteDate: (date: string) => request<{ deleted: boolean }>(`/dates/${date}`, { method: 'DELETE' }),
  plugins: () => request<{ plugins: PluginView[] }>('/plugins').then((r) => r.plugins),
  savePlugin: (name: string, config: Record<string, unknown>) =>
    request<{ plugin: PluginView }>(`/plugins/${name}`, { method: 'PUT', body: JSON.stringify(config) }).then((r) => r.plugin),
  testPlugin: (name: string) => request<{ ok: true }>(`/plugins/${name}/test`, { method: 'POST' }),
};
