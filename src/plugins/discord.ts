import type { LogEntry, LogLevel } from '../core/types.js';
import { LOG_LEVELS, isLogLevel } from '../core/types.js';
import { safeStringify } from '../core/utils.js';
import type { LogViewerPlugin, PluginConfig, PluginSettingsField } from './plugin.js';

export interface DiscordPluginOptions {
  /** Discord webhook URL (Server Settings -> Integrations -> Webhooks). */
  webhookUrl?: string;
  /** Only entries at or above this level are sent. Default `error`. */
  minLevel?: LogLevel;
  /** Default `true` when a webhook URL is present. */
  enabled?: boolean;
  /** Override the webhook's display name. */
  username?: string;
  /** Text prepended to every message (e.g. "@here" or a role mention). */
  mention?: string;
  /** Application name shown in the embed footer. */
  appName?: string;
  /** Injected for tests. Defaults to global fetch. */
  fetch?: typeof fetch;
}

const EMBED_COLORS: Record<LogLevel, number> = {
  debug: 0x95a5a6,
  info: 0x3498db,
  warn: 0xf1c40f,
  error: 0xe74c3c,
};

const WEBHOOK_HOSTS = new Set(['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com']);

export function isDiscordWebhookUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && WEBHOOK_HOSTS.has(u.hostname) && u.pathname.startsWith('/api/webhooks/');
  } catch {
    return false;
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function buildDiscordPayload(entry: LogEntry, opts: { username?: string; mention?: string; appName?: string }) {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: 'Level', value: entry.level.toUpperCase(), inline: true },
    { name: 'Time', value: entry.ts, inline: true },
  ];
  if (entry.source) fields.push({ name: 'Source', value: truncate(entry.source, 1024), inline: true });
  if (entry.context) {
    fields.push({ name: 'Context', value: truncate(`\`\`\`json\n${safeStringify(entry.context)}\n\`\`\``, 1024) });
  }

  let description = '';
  if (entry.error) {
    const body = entry.error.stack ?? `${entry.error.name}: ${entry.error.message}`;
    description = truncate(`\`\`\`\n${body}\n\`\`\``, 4096);
  }

  return {
    content: opts.mention ? truncate(opts.mention, 2000) : undefined,
    username: opts.username,
    embeds: [
      {
        title: truncate(`${entry.level === 'error' ? '🚨' : entry.level === 'warn' ? '⚠️' : 'ℹ️'} ${entry.message}`, 256),
        description: description || undefined,
        color: EMBED_COLORS[entry.level],
        fields,
        footer: { text: `${opts.appName ?? 'node-log-viewer'} • ${entry.id}` },
        timestamp: entry.ts,
      },
    ],
  };
}

/**
 * Sends log entries to a Discord channel through an incoming webhook.
 * Deliveries are queued and sent one at a time; 429 responses honour `retry_after`.
 */
export class DiscordWebhookPlugin implements LogViewerPlugin {
  readonly name = 'discord';
  readonly title = 'Discord';
  readonly description = 'Send log entries to a Discord channel via an incoming webhook.';
  minLevel: LogLevel;
  enabled: boolean;

  private webhookUrl: string | undefined;
  private username: string | undefined;
  private mention: string | undefined;
  private appName: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private queue: Promise<void> = Promise.resolve();

  readonly settingsSchema: PluginSettingsField[] = [
    { key: 'enabled', label: 'Enabled', type: 'boolean', description: 'Turn Discord notifications on or off.' },
    {
      key: 'webhookUrl',
      label: 'Webhook URL',
      type: 'password',
      required: true,
      placeholder: 'https://discord.com/api/webhooks/…',
      description: 'Discord → Server Settings → Integrations → Webhooks → New Webhook → Copy URL.',
    },
    {
      key: 'minLevel',
      label: 'Minimum level',
      type: 'select',
      description: 'Only entries at or above this level are sent.',
      options: LOG_LEVELS.map((l) => ({ value: l, label: l.toUpperCase() })),
    },
    { key: 'username', label: 'Bot display name', type: 'text', placeholder: 'App Logger' },
    { key: 'mention', label: 'Mention', type: 'text', placeholder: '@here or <@&ROLE_ID>', description: 'Optional text prepended to each message.' },
    { key: 'appName', label: 'Application name', type: 'text', placeholder: 'my-api', description: 'Shown in the embed footer.' },
  ];

  constructor(options: DiscordPluginOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.minLevel = options.minLevel ?? 'error';
    this.webhookUrl = options.webhookUrl;
    this.username = options.username;
    this.mention = options.mention;
    this.appName = options.appName;
    this.enabled = options.enabled ?? Boolean(options.webhookUrl);
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('DiscordWebhookPlugin requires a global fetch (Node 18+) or an injected fetch implementation.');
    }
  }

  getConfig(): PluginConfig {
    return {
      enabled: this.enabled,
      webhookUrl: this.webhookUrl ?? '',
      minLevel: this.minLevel,
      username: this.username ?? '',
      mention: this.mention ?? '',
      appName: this.appName ?? '',
    };
  }

  configure(config: PluginConfig): void {
    const next = { ...this.getConfig(), ...config };
    const url = typeof next.webhookUrl === 'string' ? next.webhookUrl.trim() : '';
    const enabled = Boolean(next.enabled);
    if (enabled && !isDiscordWebhookUrl(url)) {
      throw new Error('A valid Discord webhook URL (https://discord.com/api/webhooks/...) is required to enable the plugin.');
    }
    if (url && !isDiscordWebhookUrl(url)) {
      throw new Error('Webhook URL must be a Discord webhook (https://discord.com/api/webhooks/...).');
    }
    if (next.minLevel !== undefined && next.minLevel !== '' && !isLogLevel(next.minLevel)) {
      throw new Error(`Invalid minLevel "${String(next.minLevel)}"`);
    }
    this.webhookUrl = url || undefined;
    this.enabled = enabled;
    if (isLogLevel(next.minLevel)) this.minLevel = next.minLevel;
    this.username = str(next.username);
    this.mention = str(next.mention);
    this.appName = str(next.appName);
  }

  onLog(entry: LogEntry): Promise<void> {
    if (!this.enabled || !this.webhookUrl) return Promise.resolve();
    return this.enqueue(buildDiscordPayload(entry, { username: this.username, mention: this.mention, appName: this.appName }));
  }

  async test(): Promise<void> {
    if (!this.webhookUrl) throw new Error('No webhook URL configured.');
    const entry: LogEntry = {
      id: 'test',
      ts: new Date().toISOString(),
      level: 'info',
      message: 'Test message from node-log-viewer',
      source: 'node-log-viewer',
      context: { ok: true },
    };
    await this.send(buildDiscordPayload(entry, { username: this.username, mention: undefined, appName: this.appName }));
  }

  async close(): Promise<void> {
    await this.queue;
  }

  private enqueue(payload: unknown): Promise<void> {
    const op = this.queue.then(() => this.send(payload));
    this.queue = op.catch(() => undefined);
    return op;
  }

  private async send(payload: unknown, attempt = 0): Promise<void> {
    const url = this.webhookUrl;
    if (!url) throw new Error('No webhook URL configured.');
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status === 429 && attempt < 2) {
      const retryAfter = await readRetryAfterMs(res);
      await new Promise((r) => setTimeout(r, retryAfter));
      return this.send(payload, attempt + 1);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Discord webhook responded ${res.status}${text ? `: ${truncate(text, 300)}` : ''}`);
    }
  }
}

async function readRetryAfterMs(res: Response): Promise<number> {
  const header = res.headers.get('retry-after');
  if (header && !Number.isNaN(Number(header))) return Math.min(30000, Number(header) * 1000);
  try {
    const body = (await res.json()) as { retry_after?: number };
    if (typeof body.retry_after === 'number') return Math.min(30000, body.retry_after * 1000);
  } catch {
    // ignore
  }
  return 1000;
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

export function discordPlugin(options?: DiscordPluginOptions): DiscordWebhookPlugin {
  return new DiscordWebhookPlugin(options);
}
