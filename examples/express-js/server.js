// Plain JavaScript (CommonJS) - no TypeScript required.
const express = require('express');
const { initLogger, createLogViewer, discordPlugin, log } = require('node-log-viewer');
const usersRouter = require('./users');

// 1. Initialise the global logger ONCE. Files go to ./logs/YYYY-MM-DD.log (git-ignored automatically).
//    Every other file just does `const { log } = require('node-log-viewer')` - see users.js.
initLogger({
  dir: 'logs',
  level: 'debug',
  plugins: [
    // Configure the webhook here or later from the UI (Plugins tab).
    discordPlugin({ webhookUrl: process.env.DISCORD_WEBHOOK_URL, minLevel: 'error' }),
  ],
});

const app = express();
app.use(express.json());

// 2. Mount the web UI (uses the global logger by default). Open http://localhost:4000/logs
app.use(
  '/logs',
  createLogViewer({
    title: 'Example API logs',
    // Optional protection (off by default):
    // auth: { type: 'basic', username: 'admin', password: process.env.LOGS_PASSWORD },
  }),
);

// 3. Log from anywhere with `log`.
app.get('/', (req, res) => {
  log.info('Home page requested', { ip: req.ip });
  res.send('Hello! Visit /logs to see the log viewer. Try /boom, /warn, /users/42.');
});

app.use('/users', usersRouter);

app.get('/warn', (req, res) => {
  log.warn('Deprecated endpoint called', { path: req.path });
  res.send('warned');
});

app.get('/boom', (req, res) => {
  try {
    JSON.parse('{ definitely not json');
  } catch (err) {
    // 4. Record caught exceptions with their stack trace.
    log.exception(err, { route: req.path, query: req.query });
  }
  res.status(500).send('Something went wrong (logged).');
});

// 5. Catch everything that was not handled.
app.use((err, req, res, _next) => {
  log.exception(err, { route: req.path, method: req.method });
  res.status(500).json({ error: 'Internal error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  log.info('Server started', { port: Number(port) });
  console.log(`Log viewer: http://localhost:${port}/logs`);
});

process.on('SIGINT', async () => {
  await log.close();
  process.exit(0);
});
