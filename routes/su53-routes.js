// su53-routes.js
// SU53 agent API routes. Mounted at /api/su53 in server.js:
//   app.use('/api/su53', require('./routes/su53-routes'));
// Isolated — safe to disable by commenting that one line.

const express = require('express');
const router = express.Router();
const agent = require('../su53/su53-agent');
const su53db = require('../su53/su53-db'); /* SU53_DB_PATCH */

const RECENT = [];

// POST /api/su53/ingest — called by SAP custom transaction (RFC/HTTP) on auth error.
router.post('/ingest', async (req, res) => {
  try {
    const p = req.body || {};
    if (!p.user || !p.authObject) {
      return res.status(400).json({ error: 'user and authObject are required' });
    }
    const result = await agent.investigate(p);
    result.id = Date.now().toString(36);
    try { await su53db.insertEvent(result); } catch (dberr) { console.error('su53 insert failed:', dberr.message); }
    RECENT.unshift({ ...result });            // best-effort in-memory cache
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
router.get('/recent', async (req, res) => {
  try {
    const status = (req.query && req.query.status) ? String(req.query.status) : 'open';
    const items = await su53db.listEvents(status);
    res.json({ items });
  } catch (e) {
    // fallback to in-memory cache if DB is unreachable
    res.json({ items: RECENT, warning: 'db unavailable, showing cache: ' + String(e.message || e) });
  }
});

// POST /api/su53/score-more — /* SCORE_MORE_ROUTE */ score the next batch of pending roles on demand.
router.post('/score-more', async (req, res) => {
  try {
    const id = req.body && req.body.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    let item = null;
    try { item = await su53db.getEvent(id); } catch (e) { /* fall through to cache */ }
    if (!item) item = RECENT.find(x => x.id === id);
    if (!item) return res.status(404).json({ error: 'item not found' });

    const pending = Array.isArray(item.pendingRoles) ? item.pendingRoles : [];
    if (!pending.length) {
      return res.json({ id, added: [], scoredCount: (item.suggestions||[]).length, remaining: 0 });
    }

    const batch = Math.max(1, parseInt((req.body && req.body.limit) || item.moreBatch || 20, 10));
    const names = pending.slice(0, batch);

    // Rebuild the context objects the scorer needs from the stored item.
    const ctx = item.context;
    const uc  = await agent.getUserContext(ctx.user);

    // Score just this batch, then merge into the item and re-rank the whole
    // scored set so ordering stays correct (clean-first) across batches.
    const newlyScored = await agent.scoreRoleNames(names, ctx, uc);
    const mergedScored = (item.suggestions || []).concat(newlyScored);
    // scoreRoleNames already ranks; re-rank the union for a stable global order.
    // (rank is not exported, so we sort here with the same primary keys.)
    mergedScored.sort((a, b) => {
      if (a.clean !== b.clean) return a.clean ? -1 : 1;
      if (a.groupMatch !== b.groupMatch) return a.groupMatch ? -1 : 1;
      if ((b.score||0) !== (a.score||0)) return (b.score||0) - (a.score||0);
      const at = a.tcodeCount==null?1e9:a.tcodeCount, bt = b.tcodeCount==null?1e9:b.tcodeCount;
      if (at !== bt) return at - bt;
      return String(a.role).localeCompare(String(b.role));
    });

    item.suggestions  = mergedScored;
    item.pendingRoles = pending.slice(names.length);
    item.scoredCount  = mergedScored.length;
    try { await su53db.updateScoring(id, item.suggestions, item.pendingRoles); } catch (e) { console.error('su53 updateScoring failed:', e.message); }

    res.json({
      id,
      added: newlyScored,               // just-scored batch (already ranked)
      suggestions: mergedScored,        // full ranked list so far
      scoredCount: mergedScored.length,
      remaining: item.pendingRoles.length,
      moreBatch: item.moreBatch || 20,
    });
  } catch (e) {
    res.status(500).json({ error: 'score-more failed', detail: String(e.message || e) });
  }
});

// POST /api/su53/resolve — Option A lifecycle: mark an event resolved or dismissed.
router.post('/resolve', async (req, res) => {
  try {
    const id = req.body && req.body.id;
    const action = req.body && req.body.action;
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (action !== 'resolved' && action !== 'dismissed') {
      return res.status(400).json({ error: "action must be 'resolved' or 'dismissed'" });
    }
    const by = (req.session && req.session.user && (req.session.user.username || req.session.user.displayName)) || 'ADMIN';
    const okDone = await su53db.setStatus(id, action, by, (req.body && req.body.note) || null);
    if (!okDone) return res.status(404).json({ error: 'event not found' });
    // keep the in-memory cache consistent
    const idx = RECENT.findIndex(x => x.id === id);
    if (idx !== -1) RECENT.splice(idx, 1);
    res.json({ id, status: action });
  } catch (e) {
    res.status(500).json({ error: 'resolve failed', detail: String(e.message || e) });
  }
});

// GET /api/su53/health
router.get('/health', (req, res) => {
  res.json({ ok: true, module: 'su53-agent', ts: new Date().toISOString() });
});

module.exports = router;
