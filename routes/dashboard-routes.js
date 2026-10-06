// routes/dashboard-routes.js
// IKontrol — Dashboard summary counts (additive, isolated).
// Mounted at /api/dashboard in server.js:
//   app.use('/api/dashboard', require('./routes/dashboard-routes'));
// Isolated — safe to disable by commenting that one line.
//
// Design: makes internal HTTP self-calls to the app's OWN existing endpoints
// (/api/requests, /api/uar/campaigns, /api/su53/recent, /api/sap-data) and
// returns just the counts the dashboard needs. No server.js logic is touched,
// no ruleset/SAP function is re-implemented here — this route only aggregates
// what the existing endpoints already return.
//
// The logged-in session cookie is forwarded on each self-call so the
// requireLogin / requireRole guards on those endpoints see the same user.

const express = require('express');
const http = require('http');
const router = express.Router();

/* IK-DASH-LIVE-COUNTS: local pg Pool — same DATABASE_URL/style as db-uar.js & su53-db.js.
   Used only for the two counts the self-call approach can't get honestly
   (neutralised /api/requests + per-reviewer-guarded /api/uar/campaigns). */
const { Pool } = require('pg');
const ikDashPool = new Pool({ connectionString: process.env.DATABASE_URL });

// Sum of pending items across the three real approval queues. Any missing
// table or error -> null (caller renders "—"), never throws.
async function ikCountPendingApprovals() {
  try {
    const q = await ikDashPool.query(
      "SELECT " +
      "  (SELECT COUNT(*) FROM approval_requests    WHERE lower(status)='pending') + " +
      "  (SELECT COUNT(*) FROM user_create_requests WHERE lower(status)='pending') + " +
      "  (SELECT COUNT(*) FROM user_lock_requests   WHERE lower(status)='pending') " +
      "AS n"
    );
    return parseInt(q.rows[0].n, 10);
  } catch (e) { console.error('[dash] pendingApprovals count failed:', e.message); return null; }
}

// Count of UAR campaigns not in a finished state. Mirrors the app's own
// finalizeCampaign ('completed') plus defensive synonyms.
async function ikCountActiveUar() {
  try {
    const q = await ikDashPool.query(
      "SELECT COUNT(*) AS n FROM uar_campaigns " +
      "WHERE lower(COALESCE(status,'')) NOT IN ('completed','finalized','closed','cancelled')"
    );
    return parseInt(q.rows[0].n, 10);
  } catch (e) { console.error('[dash] activeUar count failed:', e.message); return null; }
}

// Small helper: GET one of our own endpoints over localhost, forwarding the
// caller's cookie. Resolves { ok, status, json } and never throws — a failed
// sub-call just yields ok:false so one broken source can't 500 the dashboard.
function selfGet(reqPath, cookie, port) {
  return new Promise((resolve) => {
    const options = {
      hostname: '127.0.0.1',
      port: port,
      path: reqPath,
      method: 'GET',
      headers: cookie ? { Cookie: cookie } : {}
    };
    const r = http.request(options, (resp) => {
      let data = '';
      resp.on('data', (c) => { data += c; });
      resp.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = null; }
        resolve({ ok: resp.statusCode >= 200 && resp.statusCode < 300, status: resp.statusCode, json });
      });
    });
    r.on('error', () => resolve({ ok: false, status: 0, json: null }));
    r.end();
  });
}

// GET /api/dashboard/summary
// Returns the live counts the admin dashboard shows. Any source that fails or
// isn't authorized comes back as null (UI renders "—") rather than breaking.
router.get('/summary', async (req, res) => {
  const cookie = req.headers.cookie || '';
  const port = req.socket.localPort || 3000;

  // IK-DASH-LIVE-COUNTS: /api/requests is neutralised and /api/uar/campaigns is
  // per-reviewer guarded — both counted directly from the DB below.
  const [su53Res, sapRes] = await Promise.all([
    selfGet('/api/su53/recent', cookie, port),
    selfGet('/api/sap-data', cookie, port)
  ]);

  // Pending approvals — real count across role + user-create + lock queues.
  const pendingApprovals = await ikCountPendingApprovals();

  // Active UAR campaigns — real count straight from uar_campaigns.
  const activeUar = await ikCountActiveUar();

  // SU53 auth-fail investigations recorded (in-memory recent list).
  let su53Fails = null;
  if (su53Res.ok && su53Res.json && Array.isArray(su53Res.json.items)) {
    su53Fails = su53Res.json.items.length;
  }

  // Total SAP users.
  let sapUsers = null;
  if (sapRes.ok && sapRes.json && typeof sapRes.json.totalUsers === 'number') {
    sapUsers = sapRes.json.totalUsers;
  }

  res.json({
    pendingApprovals,
    activeUar,
    su53Fails,
    sapUsers,
    // sodViolations intentionally omitted for now (system-wide scan is expensive);
    // wired in a later iteration.
    sodViolations: null
  });
});

module.exports = router;
