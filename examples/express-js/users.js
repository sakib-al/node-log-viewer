// A separate module: no setup needed, just import `log`.
// It writes to the same files (and plugins) configured by initLogger() in server.js.
const { Router } = require('express');
const { log } = require('node-log-viewer');

// Optional: a child logger tags every entry from this file with a source.
const usersLog = log.child({ source: 'UsersController' });

const router = Router();

router.get('/:id', (req, res) => {
  usersLog.debug('Loading user', { id: req.params.id, requestId: Date.now().toString(36) });

  if (req.params.id === '0') {
    usersLog.warn('Suspicious user id requested', { id: req.params.id });
    return res.status(400).json({ error: 'invalid id' });
  }

  res.json({ id: req.params.id, name: 'Jane' });
});

module.exports = router;
