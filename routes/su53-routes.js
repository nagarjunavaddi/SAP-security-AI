// su53-routes.js
// SU53 agent API routes. Mounted at /api/su53 in server.js:
//   app.use('/api/su53', require('./routes/su53-routes'));
// Isolated — safe to disable by commenting that one line.

const express = require('express');
const router = express.Router();
const agent = require('../su53/su53-agent');

const RECENT = [];

// POST /api/su53/ingest — called by SAP custom transaction (RFC/HTTP) on auth error.
router.post('/ingest', async (req, res) => {
  try {
    const p = req.body || {};
    if (!p.user || !p.authObject) {
      return res.status(400).json({ error: 'user and authObject are required' });
    }
    const result = await agent.investigate(p);
    RECENT.unshift({ id: Date.now().toString(36), ...result });
    if (RECENT.length > 50) RECENT.pop();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'investigation failed', detail: String(e.message || e) });
  }
});

// POST /api/su53/investigate — manual/UI-driven testing.
router.post('/investigate', async (req, res) => {
  try {
    const result = await agent.investigate(req.body || {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'investigation failed', detail: String(e.message || e) });
  }
});

// GET /api/su53/recent
router.get('/recent', (req, res) => { res.json({ items: RECENT }); });

// GET /api/su53/health
router.get('/health', (req, res) => {
  res.json({ ok: true, module: 'su53-agent', ts: new Date().toISOString() });
});

module.exports = router;
