# node-log-viewer

File-based logging for Node.js and NestJS with a built-in web UI, inspired by Laravel's log-viewer.

- Writes one JSON-lines file per day (`logs/2026-09-05.log`) and keeps them out of git automatically.
- Ships a React log viewer you mount inside your app (`/logs`): browse by date, filter by level (All / Debug / Info / Warning / Error), full-text search, expandable stack traces and context, live refresh, dark mode.
- Configure once with `initLogger()`, then `import { log } from 'node-log-viewer'` in any file: `log.exception(err)` for `catch` blocks, plus `debug` / `info` / `warn` / `error` and child loggers with a `source`.
- Plugin system: forward entries anywhere. Discord webhook plugin included and configurable from the UI.
- Works in plain JavaScript (CommonJS) or TypeScript, Express or raw `http`, and NestJS via `node-log-viewer/nest`.
- Zero runtime dependencies. Optional basic-auth (or your own `authorize` hook) for the viewer.

## Install

```bash
npm install node-log-viewer
# pnpm add node-log-viewer / yarn add node-log-viewer
```

Requires Node.js 18+.

## Quick start (Express / plain JavaScript)

Set the logger up **once** at startup with `initLogger()`, mount the UI, and then use `log` from any file in your project. No re-configuration, no passing a logger instance around.

**`app.js` (or `app.ts`) – run once at startup**

```js
const express = require('express');
const { initLogger, createLogViewer, discordPlugin, log } = require('node-log-viewer');

initLogger({
  dir: 'logs',                // default: ./logs
  level: 'debug',             // minimum level to record
  plugins: [discordPlugin()], // configure the webhook in the UI later, or pass { webhookUrl }
});

const app = express();
app.use('/logs', createLogViewer({ title: 'My API logs' })); // UI at http://localhost:3000/logs

app.use('/users', require('./routes/users'));

app.listen(3000, () => log.info('Server started', { port: 3000 }));
```

**`routes/users.js` (or any other file) – just import `log`**

```js
const { Router } = require('express');
const { log } = require('node-log-viewer');

const router = Router();

router.get('/:id', (req, res) => {
  log.info('Loading user', { id: req.params.id });
  try {
    JSON.parse('{ nope');
  } catch (err) {
    log.exception(err, { route: req.path }); // stack trace + context are stored
  }
  res.json({ id: req.params.id });
});

module.exports = router;
```

Both files write to the same daily file, show up in the same UI and reach the same plugins.

TypeScript / ESM:

```ts
// app.ts
import { initLogger, createLogViewer } from 'node-log-viewer';
initLogger({ dir: 'logs' });
app.use('/logs', createLogViewer());

// services/payment.service.ts
import { log } from 'node-log-viewer';
const paymentLog = log.child({ source: 'PaymentService' }); // optional: tag entries from this file
paymentLog.info('Charged card', { amount: 10 });
```

Raw `http` server (no framework):

```js
const http = require('http');
const { initLogger, createLogViewer } = require('node-log-viewer');
initLogger({ dir: 'logs' });
const viewer = createLogViewer({ basePath: '/logs' });
http.createServer((req, res) => (req.url.startsWith('/logs') ? viewer(req, res) : res.end('app'))).listen(3000);
```

### How the global logger works

| Function                | Purpose                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `initLogger(options)`   | Creates the global logger. Call it once at startup. Calling it again returns the same instance (pass `force: true` to replace it). |
| `log`                   | Global facade: `log.debug/info/warn/error/exception/log/child/use/flush/close`. Always forwards to the current global logger. |
| `getLogger()`           | Returns the global `Logger` instance (creates one with default options if `initLogger` was never called).  |
| `setLogger(logger)`     | Makes a logger you created with `createLogger()` the global one.                                           |
| `isLoggerInitialized()` | `true` after `initLogger()` / `setLogger()`.                                                               |

`log` is safe to import in modules that load *before* `initLogger()` runs: calls are resolved at call time, so once `initLogger()` has executed everything goes to the configured logger. If you never call `initLogger()`, `log` falls back to a logger with default options (`./logs`).

`createLogViewer()` uses the global logger when you do not pass `logger`. In NestJS, `LogViewerModule.forRoot()` registers its logger as the global one automatically, so `import { log } from 'node-log-viewer/nest'` works in any Nest file as well.

Prefer explicit instances? `createLogger()` still returns an independent `Logger` you can pass around, and you can hand it to the UI with `createLogViewer({ logger })`.

## NestJS

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { LogViewerModule, discordPlugin } from 'node-log-viewer/nest';

@Module({
  imports: [
    LogViewerModule.forRoot({
      dir: 'logs',
      path: '/logs',              // UI mount path (absolute; not affected by setGlobalPrefix). `false` disables the UI.
      plugins: [discordPlugin()],
      catchExceptions: true,      // default: global filter records unhandled 5xx exceptions
      // logClientErrors: true,   // also record 4xx HttpExceptions as warnings
      // auth: { type: 'basic', username: 'admin', password: process.env.LOGS_PASSWORD! },
    }),
  ],
})
export class AppModule {}
```

```ts
// main.ts
import { NestFactory } from '@nestjs/core';
import { LogViewerLogger } from 'node-log-viewer/nest';

const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(LogViewerLogger)); // Nest's own Logger now writes to the log files too
await app.listen(3000);
```

Log from any file: `LogViewerModule.forRoot()` makes its logger the global one, so the simplest option is the `log` facade:

```ts
import { Injectable } from '@nestjs/common';
import { log } from 'node-log-viewer/nest';

@Injectable()
export class UsersService {
  private readonly log = log.child({ source: UsersService.name });
  find(id: string) {
    this.log.debug('Loading user', { id });
  }
}
```

Prefer dependency injection? The `Logger` instance is also provided globally:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'node-log-viewer/nest';

@Injectable()
export class UsersService {
  private readonly log: Logger;
  constructor(@Inject(Logger) logger: Logger) {
    this.log = logger.child({ source: UsersService.name });
  }
}
```

`@nestjs/common` and `@nestjs/core` (v9+) are optional peer dependencies; they are only needed when you import `node-log-viewer/nest`. The Express adapter is tested; Fastify works through Nest's middleware support (`@fastify/middie`).

## Logging API

The same methods exist on the global `log` facade and on any `Logger` instance (`createLogger()`, `getLogger()`, `log.child()`).

```ts
import { log } from 'node-log-viewer';

log.debug(message, context?);
log.info(message, context?);
log.warn(message, context?);
log.error(message, context?);   // context may be an Error, or { error, ...more }
log.error(err);                 // same as log.exception(err)
log.exception(err, context?, message?); // level "error", serializes name/message/stack/cause/own props
log.log(level, message, context?);

const child = log.child({ source: 'PaymentService', context: { requestId } });
child.info('Charged card', { amount: 10 }); // entry carries source + merged context

log.use(plugin);      // register a plugin at runtime
log.instance;         // the underlying global Logger
await log.flush();    // wait for pending file writes and plugin deliveries
await log.close();    // flush and close plugins (call on shutdown)
```

Each line in a day file looks like:

```json
{"id":"01a0…","ts":"2026-09-05T13:38:36.895Z","level":"error","message":"SyntaxError: Expected property name","source":"UsersController","context":{"route":"/boom"},"error":{"name":"SyntaxError","message":"Expected property name","stack":"SyntaxError: …\n    at …"}}
```

### `initLogger(options)` / `createLogger(options)`

`initLogger()` creates the global logger (accepts `force: true` to replace an existing one); `createLogger()` returns an independent instance. Both take the same options:

| Option      | Default                              | Description                                                        |
| ----------- | ------------------------------------ | ------------------------------------------------------------------ |
| `dir`       | `'logs'`                             | Directory for daily files (relative to `process.cwd()` or absolute). |
| `level`     | `'debug'`                            | Minimum level recorded.                                            |
| `console`   | `NODE_ENV !== 'production'`          | Also print entries to the console.                                 |
| `gitignore` | `true`                               | Write a `.gitignore` (`*`) inside `dir`.                           |
| `source`    | `undefined`                          | Default `source` for entries.                                      |
| `plugins`   | `[]`                                 | Plugins to register.                                               |
| `extension` | `'log'`                              | File extension of daily files.                                     |

### `createLogViewer(options)`

Returns a Node `(req, res, next?)` handler usable with Express (`app.use('/logs', handler)`), Nest middleware, or `http.createServer`.

| Option              | Default        | Description                                                                 |
| ------------------- | -------------- | --------------------------------------------------------------------------- |
| `logger`            | global logger  | The logger whose files to show. Defaults to the one from `initLogger()`.    |
| `basePath`          | auto           | Mount path. Auto-detected from Express `baseUrl`; set it for raw `http`.    |
| `auth`              | `undefined`    | `{ type: 'basic', username, password }` or `{ type: 'custom', authorize(req) }`. |
| `title`             | `'Log Viewer'` | Title shown in the UI.                                                      |
| `allowDelete`       | `true`         | Allow deleting a day's file from the UI.                                    |
| `allowPluginConfig` | `true`         | Allow editing plugin settings from the UI.                                  |

### JSON API (under the mount path)

| Method   | Path                          | Description                                                          |
| -------- | ----------------------------- | -------------------------------------------------------------------- |
| `GET`    | `/api/meta`                   | Title, version, log dir, capabilities.                               |
| `GET`    | `/api/dates`                  | Available days with per-level counts and sizes.                      |
| `GET`    | `/api/logs`                   | `?date=YYYY-MM-DD&level=all|debug|info|warn|error&search=&page=&pageSize=&order=desc|asc` |
| `DELETE` | `/api/dates/:date`            | Delete a day's file.                                                 |
| `GET`    | `/api/plugins`                | Registered plugins, settings schema and (secret-masked) config.      |
| `PUT`    | `/api/plugins/:name`          | Save plugin config (blank password fields keep the stored secret).   |
| `POST`   | `/api/plugins/:name/test`     | Send a test message through the plugin.                              |

## Plugins

A plugin is a log sink. It receives every entry at or above its `minLevel` and can forward it anywhere. Failures inside a plugin are caught and reported to the console; they never affect your app or the file log.

### Discord (built in)

```ts
import { initLogger, discordPlugin } from 'node-log-viewer';

initLogger({
  plugins: [
    discordPlugin({
      webhookUrl: process.env.DISCORD_WEBHOOK_URL, // or leave empty and paste it in the UI
      minLevel: 'error',                           // default
      username: 'API Logger',
      mention: '@here',
      appName: 'my-api',
    }),
  ],
});
```

Create the webhook in Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL. Open the viewer, go to **Plugins**, paste the URL, choose the minimum level and click **Send test message**. Settings are saved to `<dir>/.log-viewer.json`, which lives next to the log files and is covered by the same `.gitignore`. Saved settings are re-applied automatically on the next start.

Entries are queued and delivered one at a time; Discord `429` rate limits are honoured using `retry_after`.

### Writing your own plugin

```ts
import type { LogViewerPlugin, LogEntry } from 'node-log-viewer';

class SlackPlugin implements LogViewerPlugin {
  name = 'slack';
  title = 'Slack';
  minLevel = 'error' as const;
  enabled = true;
  private url = '';

  settingsSchema = [
    { key: 'enabled', label: 'Enabled', type: 'boolean' as const },
    { key: 'url', label: 'Incoming webhook URL', type: 'password' as const, required: true },
  ];
  getConfig() { return { enabled: this.enabled, url: this.url }; }
  configure(c: Record<string, unknown>) { this.enabled = Boolean(c.enabled); this.url = String(c.url ?? ''); }
  async test() { await this.post('Test from node-log-viewer'); }

  async onLog(entry: LogEntry) {
    await this.post(`[${entry.level}] ${entry.message}`);
  }
  private async post(text: string) {
    const res = await fetch(this.url, { method: 'POST', body: JSON.stringify({ text }) });
    if (!res.ok) throw new Error(`Slack responded ${res.status}`);
  }
}

log.use(new SlackPlugin()); // or pass it in initLogger({ plugins: [...] })
```

Anything with a `settingsSchema` gets a generated form on the UI's Plugins page.

## Protecting the viewer

Off by default so it never gets in the way during development. Turn it on for shared or production environments:

```ts
createLogViewer({
  auth: { type: 'basic', username: 'admin', password: process.env.LOGS_PASSWORD },
});

// or plug in your own session / token check
createLogViewer({
  auth: { type: 'custom', authorize: (req) => req.headers['x-admin-token'] === process.env.ADMIN_TOKEN },
});
```

You can also disable destructive UI actions with `allowDelete: false` and `allowPluginConfig: false`.

## Git ignore behaviour

On first use the logger creates the log directory and writes a `.gitignore` containing `*` into it (the same trick Laravel uses for `storage/`). Log files and the plugin settings file are therefore never committed, even if you forget to update your project's `.gitignore`. Disable with `gitignore: false`.

## Examples

- [`examples/express-js`](examples/express-js) – plain JavaScript (no TypeScript) Express app; `server.js` calls `initLogger()` once and `users.js` just imports `log`.
- [`examples/nest`](examples/nest) – NestJS app using `LogViewerModule`, `LogViewerLogger` and the exception filter.

## Development

```bash
pnpm install
pnpm build        # builds the UI into dist/ui, then the library into dist/
pnpm test
pnpm dev:ui       # Vite dev server for the UI (proxies /api to an example app on :4000)
```

## License

MIT
