import { describe, expect, it } from 'vitest';
import { buildDiscordPayload, discordPlugin, isDiscordWebhookUrl, type LogEntry } from '../src/index.js';
import { fakeFetch } from './helpers.js';

const URL_OK = 'https://discord.com/api/webhooks/1234567890/EXAMPLE_TOKEN';

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  id: 'id1',
  ts: '2026-09-05T10:00:00.000Z',
  level: 'error',
  message: 'Something broke',
  source: 'Api',
  context: { route: '/x' },
  error: { name: 'Error', message: 'Something broke', stack: 'Error: Something broke\n    at fn (file.js:1:1)' },
  ...over,
});

describe('isDiscordWebhookUrl', () => {
  it('accepts discord webhook urls only', () => {
    expect(isDiscordWebhookUrl(URL_OK)).toBe(true);
    expect(isDiscordWebhookUrl('https://ptb.discord.com/api/webhooks/1/x')).toBe(true);
    expect(isDiscordWebhookUrl('http://discord.com/api/webhooks/1/x')).toBe(false);
    expect(isDiscordWebhookUrl('https://evil.com/api/webhooks/1/x')).toBe(false);
    expect(isDiscordWebhookUrl('https://discord.com/other')).toBe(false);
    expect(isDiscordWebhookUrl('nope')).toBe(false);
    expect(isDiscordWebhookUrl(42)).toBe(false);
  });
});

describe('buildDiscordPayload', () => {
  it('builds an embed with level colour, stack and context', () => {
    const p = buildDiscordPayload(entry(), { appName: 'svc', mention: '@here', username: 'Bot' });
    expect(p.content).toBe('@here');
    expect(p.username).toBe('Bot');
    expect(p.embeds[0].color).toBe(0xe74c3c);
    expect(p.embeds[0].title).toContain('Something broke');
    expect(p.embeds[0].description).toContain('at fn (file.js:1:1)');
    expect(p.embeds[0].fields.find((f) => f.name === 'Source')?.value).toBe('Api');
    expect(p.embeds[0].fields.find((f) => f.name === 'Context')?.value).toContain('"/x"');
    expect(p.embeds[0].footer.text).toContain('svc');
  });

  it('truncates oversized fields to Discord limits', () => {
    const p = buildDiscordPayload(entry({ message: 'm'.repeat(1000), error: { name: 'E', message: 'x', stack: 's'.repeat(10000) } }), {});
    expect(p.embeds[0].title.length).toBeLessThanOrEqual(256);
    expect((p.embeds[0].description ?? '').length).toBeLessThanOrEqual(4096);
  });
});

describe('DiscordWebhookPlugin', () => {
  it('is disabled without a webhook url and sends nothing', async () => {
    const { fetch, calls } = fakeFetch();
    const plugin = discordPlugin({ fetch });
    expect(plugin.enabled).toBe(false);
    await plugin.onLog(entry());
    expect(calls).toHaveLength(0);
  });

  it('posts entries at or above minLevel in order', async () => {
    const { fetch, calls } = fakeFetch([{ status: 204 }, { status: 204 }]);
    const plugin = discordPlugin({ webhookUrl: URL_OK, minLevel: 'warn', fetch });
    expect(plugin.enabled).toBe(true);
    await Promise.all([plugin.onLog(entry({ level: 'warn', message: 'first' })), plugin.onLog(entry({ message: 'second' }))]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(URL_OK);
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].json as { embeds: Array<{ title: string }> }).embeds[0].title).toContain('first');
    expect((calls[1].json as { embeds: Array<{ title: string }> }).embeds[0].title).toContain('second');
  });

  it('retries after a 429 using retry_after', async () => {
    const { fetch, calls } = fakeFetch([{ status: 429, body: { retry_after: 0.01 } }, { status: 204 }]);
    const plugin = discordPlugin({ webhookUrl: URL_OK, fetch });
    await plugin.onLog(entry());
    expect(calls).toHaveLength(2);
  });

  it('rejects on non-ok responses so the registry can report it', async () => {
    const { fetch } = fakeFetch([{ status: 401, body: { message: 'Invalid Webhook Token' } }]);
    const plugin = discordPlugin({ webhookUrl: URL_OK, fetch });
    await expect(plugin.onLog(entry())).rejects.toThrow(/401/);
  });

  it('validates configuration from the UI', () => {
    const { fetch } = fakeFetch();
    const plugin = discordPlugin({ fetch });
    expect(() => plugin.configure({ enabled: true, webhookUrl: '' })).toThrow(/webhook URL/i);
    expect(() => plugin.configure({ enabled: false, webhookUrl: 'https://evil.com/hook' })).toThrow(/Discord webhook/);
    expect(() => plugin.configure({ enabled: true, webhookUrl: URL_OK, minLevel: 'loud' })).toThrow(/minLevel/);

    plugin.configure({ enabled: true, webhookUrl: URL_OK, minLevel: 'warn', username: ' Bot ', appName: '' });
    expect(plugin.enabled).toBe(true);
    expect(plugin.minLevel).toBe('warn');
    expect(plugin.getConfig()).toMatchObject({ webhookUrl: URL_OK, username: 'Bot', appName: '' });

    plugin.configure({ enabled: false });
    expect(plugin.enabled).toBe(false);
    expect(plugin.getConfig().webhookUrl).toBe(URL_OK); // url kept when only toggling
  });

  it('test() sends an info embed', async () => {
    const { fetch, calls } = fakeFetch([{ status: 204 }]);
    const plugin = discordPlugin({ webhookUrl: URL_OK, fetch });
    await plugin.test();
    expect(calls).toHaveLength(1);
    expect((calls[0].json as { embeds: Array<{ title: string }> }).embeds[0].title).toContain('Test message');
    await expect(discordPlugin({ fetch }).test()).rejects.toThrow(/No webhook URL/);
  });
});
