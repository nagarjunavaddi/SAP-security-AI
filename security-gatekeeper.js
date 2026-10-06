/* ============================================================================
 * security-gatekeeper.js  [IK-SEC-GATEKEEPER v2 - CORRECTED]
 * ----------------------------------------------------------------------------
 * 100% ADDITIVE security layer for IKontrol.
 *
 * v2 FIX: the static guard now NEVER touches /api/ routes. It only blocks
 * DIRECT file fetches of sensitive files (.env, server-side .js source,
 * backups, patch scripts). All application API calls — including
 * /api/su53/*, /api/session, /api/my-profile — pass through untouched.
 *
 * What it does:
 *   1) Enforces login + role on the SAP endpoints that were previously OPEN.
 *   2) Hardens the session cookie (httpOnly + sameSite; secure in production).
 *   3) Blocks web-serving of sensitive files that express.static(__dirname)
 *      would otherwise expose — WITHOUT interfering with any /api/ route.
 *
 * Idempotent + side-effect-free on existing routes.
 * ==========================================================================*/

const db = require('./db');

// ---- Access policy (login + role) for previously-open SAP endpoints -------
const ACCESS_RULES = [
  // Admin only
  { prefix: '/api/create-user',      roles: ['admin'] },  // covers create-user AND create-users-bulk
  { prefix: '/api/chat',             roles: ['admin'] },
  { prefix: '/api/debug-permission', roles: ['admin'] },

  // Admin + manager + role_owner
  { prefix: '/api/risk-analysis',    roles: ['admin', 'manager', 'role_owner'] },
  { prefix: '/api/simulation',       roles: ['admin', 'manager', 'role_owner'] },
  { prefix: '/api/sap-data',         roles: ['admin', 'manager', 'role_owner'] },
  { prefix: '/api/sap-user-check',   roles: ['admin', 'manager', 'role_owner'] },
  { prefix: '/api/sap-role-check',   roles: ['admin', 'manager', 'role_owner'] },
];

// Sensitive DIRECT-FILE fetches to block. These are matched ONLY against
// non-/api/ GET paths, so they can never affect an application API call.
// We match by extension / basename of the actual URL path, not by any folder
// word appearing mid-path.
const BLOCKED_FILE_PATTERNS = [
  /\.env(\.|$)/i,               // .env, .env.local
  /\.js$/i,                     // server-side .js source (front-end whitelist below)
  /\.ps1$/i,                    // patch scripts
  /\.bak(-|\.|$)/i,             // server.js.bak-sec-*
  /package(-lock)?\.json$/i,
  /\.git(\/|$)/i,
];

// Front-end .js files the browser legitimately needs (whitelist).
// auth-guard.js is loaded by the HTML pages, so it MUST stay served.
const ALLOWED_JS_FILES = new Set([
  '/auth-guard.js',
  '/unified-approvals.js',   // IK: Approval Queue unified module (role + user-create + user-lock + drill-down)
]);

function resolveRole(req) {
  const sess = req.session && req.session.user;
  if (!sess || !sess.username) return Promise.resolve(null);
  return db.getUserByUsername((sess.username || '').toUpperCase())
    .then(user => (!user || user.active === false) ? null : user.role)
    .catch(() => sess.role || null);
}

function ruleFor(urlPath) {
  return ACCESS_RULES.find(r => urlPath === r.prefix || urlPath.startsWith(r.prefix));
}

/* ---- 1) Static-file block (install BEFORE express.static) ----------------
 * CRITICAL: returns early (next()) for ANYTHING under /api/ so application
 * routes are never affected. Only plain file GETs are inspected. */
function installStaticGuard(app) {
  app.use((req, res, next) => {
    // Never touch API routes — let them flow to their handlers untouched.
    if (req.path.startsWith('/api/')) return next();
    // Only guard file reads.
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const p = decodeURIComponent(req.path || '');

    // Whitelisted front-end scripts always allowed.
    if (ALLOWED_JS_FILES.has(p)) return next();

    for (const pat of BLOCKED_FILE_PATTERNS) {
      if (pat.test(p)) {
        return res.status(404).end(); // 404 so we don't confirm existence
      }
    }
    next();
  });
}

/* ---- 2) API access guard (login + role) --------------------------------- */
function installAccessGuard(app) {
  app.use(async (req, res, next) => {
    const rule = ruleFor(req.path);
    if (!rule) return next(); // not a protected endpoint

    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'Not logged in.' });
    }
    const role = await resolveRole(req);
    if (!role) {
      return res.status(401).json({ error: 'Session invalid. Please log in again.' });
    }
    if (!rule.roles.includes(role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${rule.roles.join(' or ')}. Your role: ${role}.`
      });
    }
    next();
  });
}

/* ---- 3) Session cookie hardening ---------------------------------------- */
function hardenSessionCookie(app) {
  app.use((req, res, next) => {
    if (req.session && req.session.cookie) {
      req.session.cookie.httpOnly = true;
      req.session.cookie.sameSite = 'lax';
      if (process.env.NODE_ENV === 'production') {
        req.session.cookie.secure = true;
      }
    }
    next();
  });
}

function install(app) {
  hardenSessionCookie(app);
  installAccessGuard(app);
}

module.exports = { install, installStaticGuard, installAccessGuard, hardenSessionCookie, ACCESS_RULES };
