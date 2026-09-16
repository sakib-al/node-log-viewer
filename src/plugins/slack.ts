import type { LogEntry, LogLevel } from '../core/types.js';
import { LOG_LEVELS, isLogLevel } from '../core/types.js';
import { safeStringify } from '../core/utils.js';
import type { LogViewerPlugin, PluginConfig, PluginSettingsField } from './plugin.js';

export interface SlackPluginOptions {
  /** Slack incoming webhook URL (https://hooks.slack.com/services/T…/B…/…). */
  webhookUrl?: string;
  /** Only entries at or above this level are sent. Default `error`. */
  minLevel?: LogLevel;
  /** Default `true` when a webhook URL is present. */
  enabled?: boolean;
  /** Text prepended to every message, e.g. "<!here>", "<!channel>" or "<@U012ABCDEF>". */
  mention?: string;
  /** Application name shown in the message footer. */
  appName?: string;
  /** Injected for tests. Defaults to global fetch. */
  fetch?: typeof fetch;
}

const ATTACHMENT_COLORS: Record<LogLevel, string> = {
  debug: '#95a5a6',
  info: '#3498db',
  warn: '#f1c40f',
  error: '#e74c3c',
};

const LEVEL_EMOJI: Record<LogLevel, string> = {
  debug: ':mag:',
  info: ':information_source:',
  warn: ':warning:',
  error: ':rotating_light:',
};

export function isSlackWebhookUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'hooks.slack.com' && /^\/(services|workflows|triggers)\//.test(u.pathname);
  } catch {
    return false;
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Escape the three characters Slack treats specially in mrkdwn text. */
function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type Block = Record<string, unknown>;

/**
 * Builds a Slack incoming-webhook payload. The message uses a coloured attachment (level colour)
 * containing Block Kit blocks, plus a plain-text `text` fallback for notifications.
 */
export function buildSlackPayload(entry: LogEntry, opts: { mention?: string; appName?: string }) {
  const title = truncate(`${LEVEL_EMOJI[entry.level]} ${entry.message}`, 150);
  const blocks: Block[] = [{ type: 'header', text: { type: 'plain_text', text: title, emoji: true } }];

  const fields: Array<{ type: 'mrkdwn'; text: string }> = [
    { type: 'mrkdwn', text: `*Level*\n${entry.level.toUpperCase()}` },
    { type: 'mrkdwn', text: `*Time*\n${entry.ts}` },
  ];
  if (entry.source) fields.push({ type: 'mrkdwn', text: truncate(`*Source*\n${escapeMrkdwn(entry.source)}`, 2000) });
  blocks.push({ type: 'section', fields });

  if (entry.error) {
    const body = entry.error.stack ?? `${entry.error.name}: ${entry.error.message}`;
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: truncate(`\`\`\`${escapeMrkdwn(body)}\`\`\``, 3000) } });
  }
  if (entry.context) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(`*Context*\n\`\`\`${escapeMrkdwn(safeStringify(entry.context))}\`\`\``, 3000) },
    });
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `${escapeMrkdwn(opts.appName ?? 'node-log-viewer')} • ${entry.id}` }] });

  const fallback = truncate(`[${entry.level.toUpperCase()}] ${entry.message}`, 3000);
  return {
    text: opts.mention ? `${truncate(opts.mention, 200)} ${fallback}` : fallback,
    attachments: [{ color: ATTACHMENT_COLORS[entry.level], blocks }],
  };
}

/**
 * Sends log entries to a Slack channel through an incoming webhook.
 * Deliveries are queued and sent one at a time; 429 responses honour `Retry-After`.
 */
export class SlackWebhookPlugin implements LogViewerPlugin {
  readonly name = 'slack';
  readonly title = 'Slack';
  readonly description = 'Send log entries to a Slack channel via an incoming webhook.';
  minLevel: LogLevel;
  enabled: boolean;

  private webhookUrl: string | undefined;
  private mention: string | undefined;
  private appName: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private queue: Promise<void> = Promise.resolve();

  readonly settingsSchema: PluginSettingsField[] = [
    { key: 'enabled', label: 'Enabled', type: 'boolean', description: 'Turn Slack notifications on or off.' },
    {
      key: 'webhookUrl',
      label: 'Webhook URL',
      type: 'password',
      required: true,
      placeholder: 'https://hooks.slack.com/services/…',
      description: 'Slack → api.slack.com/apps → your app → Incoming Webhooks → Add New Webhook to Workspace → Copy URL.',
    },
    {
      key: 'minLevel',
      label: 'Minimum level',
      type: 'select',
      description: 'Only entries at or above this level are sent.',
      options: LOG_LEVELS.map((l) => ({ value: l, label: l.toUpperCase() })),
    },
    {
      key: 'mention',
      label: 'Mention',
      type: 'text',
      placeholder: '<!here>, <!channel> or <@U012ABCDEF>',
      description: 'Optional text prepended to each message.',
    },
    { key: 'appName', label: 'Application name', type: 'text', placeholder: 'my-api', description: 'Shown in the message footer.' },
  ];

  constructor(options: SlackPluginOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.minLevel = options.minLevel ?? 'error';
    this.webhookUrl = options.webhookUrl;
    this.mention = options.mention;
    this.appName = options.appName;
    this.enabled = options.enabled ?? Boolean(options.webhookUrl);
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('SlackWebhookPlugin requires a global fetch (Node 18+) or an injected fetch implementation.');
    }
  }

  getConfig(): PluginConfig {
    return {
      enabled: this.enabled,
      webhookUrl: this.webhookUrl ?? '',
      minLevel: this.minLevel,
      mention: this.mention ?? '',
      appName: this.appName ?? '',
    };
  }

  configure(config: PluginConfig): void {
    const next = { ...this.getConfig(), ...config };
    const url = typeof next.webhookUrl === 'string' ? next.webhookUrl.trim() : '';
    const enabled = Boolean(next.enabled);
    if (enabled && !isSlackWebhookUrl(url)) {
      throw new Error('A valid Slack webhook URL (https://hooks.slack.com/services/...) is required to enable the plugin.');
    }
    if (url && !isSlackWebhookUrl(url)) {
      throw new Error('Webhook URL must be a Slack incoming webhook (https://hooks.slack.com/services/...).');
    }
    if (next.minLevel !== undefined && next.minLevel !== '' && !isLogLevel(next.minLevel)) {
      throw new Error(`Invalid minLevel "${String(next.minLevel)}"`);
    }
    this.webhookUrl = url || undefined;
    this.enabled = enabled;
    if (isLogLevel(next.minLevel)) this.minLevel = next.minLevel;
    this.mention = str(next.mention);
    this.appName = str(next.appName);
  }

  onLog(entry: LogEntry): Promise<void> {
    if (!this.enabled || !this.webhookUrl) return Promise.resolve();
    return this.enqueue(buildSlackPayload(entry, { mention: this.mention, appName: this.appName }));
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
    await this.send(buildSlackPayload(entry, { mention: undefined, appName: this.appName }));
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
      const header = res.headers.get('retry-after');
      const retryAfter = header && !Number.isNaN(Number(header)) ? Math.min(30000, Number(header) * 1000) : 1000;
      await new Promise((r) => setTimeout(r, retryAfter));
      return this.send(payload, attempt + 1);
    }
    if (!res.ok) {
      // Slack answers webhook errors with a short plain-text body such as "invalid_payload" or "no_service".
      const text = await res.text().catch(() => '');
      throw new Error(`Slack webhook responded ${res.status}${text ? `: ${truncate(text, 300)}` : ''}`);
    }
  }
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

export function slackPlugin(options?: SlackPluginOptions): SlackWebhookPlugin {
  return new SlackWebhookPlugin(options);
}
