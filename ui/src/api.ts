import type { DateFileInfo, LevelFilter, Meta, PluginView, PluginsResponse, ReadResult } from './types';

declare global {
  interface Window {
    __LOG_VIEWER__?: { base: string; title: string };
  }
}

export const BASE = window.__LOG_VIEWER__?.base ?? '';
export const INITIAL_TITLE = window.__LOG_VIEWER__?.title ?? 'Log Viewer';

const AUTH_STORAGE_KEY = 'nlv-basic-auth';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public authRequired = false,
    public authType?: string,
    public realm?: string,
  ) {
    super(message);
  }
}

export function getStoredAuth(): string | null {
  try {
    return sessionStorage.getItem(AUTH_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setBasicCredentials(username: string, password: string): void {
  const token = `Basic ${btoa(`${username}:${password}`)}`;
  try {
    sessionStorage.setItem(AUTH_STORAGE_KEY, token);
  } catch {
    // ignore quota / private mode
  }
}

export function clearAuth(): void {
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function hasStoredAuth(): boolean {
  return Boolean(getStoredAuth());
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = getStoredAuth();
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(auth ? { authorization: auth } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const obj = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    const msg = obj && 'error' in obj ? String(obj.error) : `${res.status} ${res.statusText}`;
    throw new ApiError(
      res.status,
      msg,
      Boolean(obj?.authRequired),
      typeof obj?.authType === 'string' ? obj.authType : undefined,
      typeof obj?.realm === 'string' ? obj.realm : undefined,
    );
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
  plugins: () => request<PluginsResponse>('/plugins').then((r) => ({ plugins: r.plugins, available: r.available ?? [] })),
  savePlugin: (name: string, config: Record<string, unknown>) =>
    request<{ plugin: PluginView }>(`/plugins/${name}`, { method: 'PUT', body: JSON.stringify(config) }).then((r) => r.plugin),
  testPlugin: (name: string) => request<{ ok: true }>(`/plugins/${name}/test`, { method: 'POST' }),
};
