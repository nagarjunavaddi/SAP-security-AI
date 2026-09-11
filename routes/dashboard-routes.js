// routes/dashboard-routes.js
// IK° Kontrol — Dashboard summary counts (additive, isolated).
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

  const [requestsRes, campaignsRes, su53Res, sapRes] = await Promise.all([
    selfGet('/api/requests', cookie, port),
    selfGet('/api/uar/campaigns', cookie, port),
    selfGet('/api/su53/recent', cookie, port),
    selfGet('/api/sap-data', cookie, port)
  ]);

  // Pending approvals — requests with status 'pending'.
  let pendingApprovals = null;
  if (requestsRes.ok && Array.isArray(requestsRes.json)) {
    pendingApprovals = requestsRes.json.filter(
      (r) => (r.status || '').toLowerCase() === 'pending'
    ).length;
  }

  // Active UAR campaigns — campaigns not finalized/completed.
  let activeUar = null;
  if (campaignsRes.ok && campaignsRes.json && Array.isArray(campaignsRes.json.campaigns)) {
    activeUar = campaignsRes.json.campaigns.filter((c) => {
      const s = (c.status || c.state || '').toString().toLowerCase();
      // Treat anything explicitly finalized/completed/closed as inactive.
      return !(s === 'finalized' || s === 'completed' || s === 'closed');
    }).length;
  }

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
