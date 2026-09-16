import { describe, expect, it } from 'vitest';
import { buildSlackPayload, slackPlugin, isSlackWebhookUrl, type LogEntry } from '../src/index.js';
import { fakeFetch } from './helpers.js';

const URL_OK = 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX';

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  id: 'id1',
  ts: '2026-09-16T10:00:00.000Z',
  level: 'error',
  message: 'Something broke',
  source: 'Api',
  context: { route: '/x' },
  error: { name: 'Error', message: 'Something broke', stack: 'Error: Something broke\n    at fn (file.js:1:1)' },
  ...over,
});

type Payload = ReturnType<typeof buildSlackPayload>;
const blocksOf = (p: Payload) => p.attachments[0].blocks as Array<{ type: string; text?: { text: string }; fields?: Array<{ text: string }>; elements?: Array<{ text: string }> }>;

describe('isSlackWebhookUrl', () => {
  it('accepts slack incoming webhook urls only', () => {
    expect(isSlackWebhookUrl(URL_OK)).toBe(true);
    expect(isSlackWebhookUrl('https://hooks.slack.com/workflows/T1/A1/1/abc')).toBe(true);
    expect(isSlackWebhookUrl('http://hooks.slack.com/services/T1/B1/x')).toBe(false);
    expect(isSlackWebhookUrl('https://slack.com/services/T1/B1/x')).toBe(false);
    expect(isSlackWebhookUrl('https://evil.com/services/T1/B1/x')).toBe(false);
    expect(isSlackWebhookUrl('https://hooks.slack.com/other')).toBe(false);
    expect(isSlackWebhookUrl('nope')).toBe(false);
    expect(isSlackWebhookUrl(42)).toBe(false);
  });
});

describe('buildSlackPayload', () => {
  it('builds a coloured attachment with header, fields, stack and context', () => {
    const p = buildSlackPayload(entry(), { appName: 'svc', mention: '<!here>' });
    expect(p.text).toBe('<!here> [ERROR] Something broke');
    expect(p.attachments[0].color).toBe('#e74c3c');
    const blocks = blocksOf(p);
    expect(blocks[0].type).toBe('header');
    expect(blocks[0].text?.text).toContain('Something broke');
    expect(blocks[1].fields?.map((f) => f.text)).toEqual(['*Level*\nERROR', '*Time*\n2026-09-16T10:00:00.000Z', '*Source*\nApi']);
    expect(blocks[2].text?.text).toContain('at fn (file.js:1:1)');
    expect(blocks[3].text?.text).toContain('"/x"');
    expect(blocks[4].type).toBe('context');
    expect(blocks[4].elements?.[0].text).toContain('svc');
  });

  it('escapes mrkdwn control characters and respects Slack limits', () => {
    const p = buildSlackPayload(entry({ message: 'm'.repeat(1000), source: 'a<b>&c', error: { name: 'E', message: 'x', stack: 's'.repeat(10000) } }), {});
    const blocks = blocksOf(p);
    expect(blocks[0].text!.text.length).toBeLessThanOrEqual(150);
    expect(blocks[1].fields![2].text).toBe('*Source*\na&lt;b&gt;&amp;c');
    expect(blocks[2].text!.text.length).toBeLessThanOrEqual(3000);
    expect(p.text.length).toBeLessThanOrEqual(3000);
  });

  it('omits stack and context blocks when the entry has none', () => {
    const p = buildSlackPayload(entry({ level: 'info', error: undefined, context: undefined, source: undefined }), {});
    expect(p.attachments[0].color).toBe('#3498db');
    expect(blocksOf(p).map((b) => b.type)).toEqual(['header', 'section', 'context']);
  });
});

describe('SlackWebhookPlugin', () => {
  it('is disabled without a webhook url and sends nothing', async () => {
    const { fetch, calls } = fakeFetch();
    const plugin = slackPlugin({ fetch });
    expect(plugin.name).toBe('slack');
    expect(plugin.enabled).toBe(false);
    await plugin.onLog(entry());
    expect(calls).toHaveLength(0);
  });

  it('posts entries in order', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200 }, { status: 200 }]);
    const plugin = slackPlugin({ webhookUrl: URL_OK, minLevel: 'warn', fetch });
    expect(plugin.enabled).toBe(true);
    await Promise.all([plugin.onLog(entry({ level: 'warn', message: 'first' })), plugin.onLog(entry({ message: 'second' }))]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(URL_OK);
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].json as Payload).text).toContain('first');
    expect((calls[1].json as Payload).text).toContain('second');
  });

  it('retries after a 429 using the Retry-After header', async () => {
    const { fetch, calls } = fakeFetch([{ status: 429, headers: { 'retry-after': '0' } }, { status: 200 }]);
    const plugin = slackPlugin({ webhookUrl: URL_OK, fetch });
    await plugin.onLog(entry());
    expect(calls).toHaveLength(2);
  });

  it('rejects on non-ok responses with Slack’s plain-text reason', async () => {
    const { fetch } = fakeFetch([{ status: 403, body: 'invalid_token' }]);
    const plugin = slackPlugin({ webhookUrl: URL_OK, fetch });
    await expect(plugin.onLog(entry())).rejects.toThrow(/403.*invalid_token/);
  });

  it('validates configuration from the UI', () => {
    const { fetch } = fakeFetch();
    const plugin = slackPlugin({ fetch });
    expect(() => plugin.configure({ enabled: true, webhookUrl: '' })).toThrow(/webhook URL/i);
    expect(() => plugin.configure({ enabled: false, webhookUrl: 'https://discord.com/api/webhooks/1/x' })).toThrow(/Slack incoming webhook/);
    expect(() => plugin.configure({ enabled: true, webhookUrl: URL_OK, minLevel: 'loud' })).toThrow(/minLevel/);

    plugin.configure({ enabled: true, webhookUrl: URL_OK, minLevel: 'warn', mention: ' <!channel> ', appName: '' });
    expect(plugin.enabled).toBe(true);
    expect(plugin.minLevel).toBe('warn');
    expect(plugin.getConfig()).toMatchObject({ webhookUrl: URL_OK, mention: '<!channel>', appName: '' });

    plugin.configure({ enabled: false });
    expect(plugin.enabled).toBe(false);
    expect(plugin.getConfig().webhookUrl).toBe(URL_OK); // url kept when only toggling
  });

  it('test() sends an info message without the mention', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200 }]);
    const plugin = slackPlugin({ webhookUrl: URL_OK, mention: '<!here>', fetch });
    await plugin.test();
    expect(calls).toHaveLength(1);
    const payload = calls[0].json as Payload;
    expect(payload.text).toBe('[INFO] Test message from node-log-viewer');
    expect(payload.attachments[0].color).toBe('#3498db');
    await expect(slackPlugin({ fetch }).test()).rejects.toThrow(/No webhook URL/);
  });
});
