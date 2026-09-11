#!/usr/bin/env node
/* ============================================================
   IK° Kontrol — Rebrand patch (text-only, additive-safe)
   IKAegis -> IK° Kontrol  (visible text only)
   - Backups every touched file to <file>.rebrand-bak (never overwrites existing bak)
   - Idempotent: only writes if content changed; re-run safe
   - NEVER touches: /api/ikaegis-users route, ikaegis-users.json,
     lowercase "ikaegis-users" literals, or // IKAegis code comments
   - UTF-8 read/write so the ° char is written correctly
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

// Each entry: file -> array of [from, to] literal replacements (global).
// Only visible/user-facing strings. "ikaegis-users" is never a key, so it can
// never be altered. Mojibake em-dash in ai-chat handled explicitly.
const PLAN = {
  'ai-chat.html': [
    ['AI Assistant \u00e2\u20ac\u201d IKAegis', 'AI Assistant \u2014 IK\u00b0 Kontrol'], // mojibake em-dash variant
    ['AI Assistant \u2014 IKAegis', 'AI Assistant \u2014 IK\u00b0 Kontrol'],
    ['IKAegis AI Assistant', 'IK\u00b0 Kontrol AI Assistant'],
  ],
  'approval-config.html': [
    ['Approval Configuration \u2014 IKAegis', 'Approval Configuration \u2014 IK\u00b0 Kontrol'],
    ['Manage IKAegis users', 'Manage IK\u00b0 Kontrol users'],
    ['>IKAegis Users<', '>IK\u00b0 Kontrol Users<'],
    ['IKAegis Users</div>', 'IK\u00b0 Kontrol Users</div>'],
    ['Remove ${username} from IKAegis?', 'Remove ${username} from IK\u00b0 Kontrol?'],
  ],
  'approvals.html': [
    ['IKAegis \u2014 Approval Queue', 'IK\u00b0 Kontrol \u2014 Approval Queue'],
  ],
  'audit-log.html': [
    ['IKAegis \u2014 Audit Log', 'IK\u00b0 Kontrol \u2014 Audit Log'],
    ["'IKAegis_AuditLog_'", "'IKKontrol_AuditLog_'"],
  ],
  'create-user.html': [
    ['IKAegis \u2014 Create SAP User', 'IK\u00b0 Kontrol \u2014 Create SAP User'],
  ],
  'index.html': [
    ['IKAegis \u2014 SAP Access Governance', 'IK\u00b0 Kontrol \u2014 SAP Access Governance'],
    ['IKAegis v1.0', 'IK\u00b0 Kontrol v1.0'],
  ],
  'login.html': [
    ['IKAegis \u2014 Sign in', 'IK\u00b0 Kontrol \u2014 Sign in'],
    ['IKAegis administrator', 'IK\u00b0 Kontrol administrator'],
    ['IKAegis v1.0', 'IK\u00b0 Kontrol v1.0'],
  ],
  'new-request.html': [
    ['IKAegis \u2014 New Access Request', 'IK\u00b0 Kontrol \u2014 New Access Request'],
  ],
  'reports-hub.html': [
    ['Reports & Monitoring - IKAegis', 'Reports & Monitoring - IK\u00b0 Kontrol'],
  ],
  'requests-hub.html': [
    ['Access Requests - IKAegis', 'Access Requests - IK\u00b0 Kontrol'],
  ],
  'reviews-hub.html': [
    ['Access Reviews - IKAegis', 'Access Reviews - IK\u00b0 Kontrol'],
  ],
  'risk-analysis.html': [
    ['Role SoD Risk Analysis \u2014 IKAegis', 'Role SoD Risk Analysis \u2014 IK\u00b0 Kontrol'],
  ],
  'risk-hub.html': [
    ['Risk Analysis - IKAegis', 'Risk Analysis - IK\u00b0 Kontrol'],
  ],
  'simulation.html': [
    ['Simulation \u2014 IKAegis', 'Simulation \u2014 IK\u00b0 Kontrol'],
  ],
  'SOD.html': [
    ['SoD Analysis \u2014 IKAegis', 'SoD Analysis \u2014 IK\u00b0 Kontrol'],
    ["'IKAegis SoD Analysis Report'", "'IK\u00b0 Kontrol SoD Analysis Report'"],
    ["'IKAegis_SoD_'", "'IKKontrol_SoD_'"],
  ],
  'uar-admin.html': [
    ['IKAegis - Create Access Review', 'IK\u00b0 Kontrol - Create Access Review'],
  ],
  'uar-inbox.html': [
    ['IKAegis - Access Review Inbox', 'IK\u00b0 Kontrol - Access Review Inbox'],
  ],
  'email-service.js': [
    ['[IKAegis-Mail]', '[IK\u00b0 Kontrol-Mail]'],
    ["'IKAegis \u2014 Your access request '", "'IK\u00b0 Kontrol \u2014 Your access request '"],
    ["'IKAegis \u2014 New request '", "'IK\u00b0 Kontrol \u2014 New request '"],
    ["'IKAegis \u2014 Request '", "'IK\u00b0 Kontrol \u2014 Request '"],
    ['Review in IKAegis', 'Review in IK\u00b0 Kontrol'],
    ['IKAegis \u2014 SAP Access Governance Platform', 'IK\u00b0 Kontrol \u2014 SAP Access Governance Platform'],
  ],
  'routes/ai-routes.js': [
    ['You are IKAegis AI Agent', 'You are IK\u00b0 Kontrol AI Agent'],
  ],
};

function applyFile(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.log('  [skip] not found: ' + rel);
    return { changed: false };
  }
  let src = fs.readFileSync(abs, 'utf8');
  const orig = src;
  const pairs = PLAN[rel];
  let hits = 0;
  for (const [from, to] of pairs) {
    if (src.indexOf(from) !== -1) {
      src = src.split(from).join(to);
      hits++;
    }
  }
  if (src === orig) {
    console.log('  [ok/idempotent] no change: ' + rel);
    return { changed: false };
  }
  // backup once
  const bak = abs + '.rebrand-bak';
  if (!fs.existsSync(bak)) {
    fs.writeFileSync(bak, orig, 'utf8');
    console.log('  [backup] ' + rel + '.rebrand-bak');
  } else {
    console.log('  [backup exists, kept] ' + rel + '.rebrand-bak');
  }
  fs.writeFileSync(abs, src, 'utf8');
  console.log('  [PATCHED] ' + rel + '  (' + hits + ' replacement group(s))');
  return { changed: true };
}

console.log('== IK\u00b0 Kontrol rebrand patch ==');
console.log('root: ' + ROOT + '\n');
let changedCount = 0;
for (const rel of Object.keys(PLAN)) {
  const r = applyFile(rel);
  if (r.changed) changedCount++;
}

// ---- verification: count remaining VISIBLE IKAegis (excluding safe internals) ----
console.log('\n-- verification: remaining "IKAegis" (excluding safe internals) --');
const SAFE = ['ikaegis-users', '// IKAegis', 'IKAegis Enterprise Design System', '// IKAegis '];
let remaining = 0;
for (const rel of Object.keys(PLAN)) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
  lines.forEach((ln, i) => {
    if (ln.indexOf('IKAegis') === -1) return;
    if (SAFE.some(s => ln.indexOf(s) !== -1)) return; // intentionally kept
    remaining++;
    console.log('  ' + rel + ':' + (i + 1) + '  ' + ln.trim().slice(0, 90));
  });
}
console.log('\nFiles patched: ' + changedCount);
console.log('Remaining visible "IKAegis": ' + remaining + (remaining === 0 ? '  ✓ clean' : '  (review above)'));
console.log('\nNote: /api/ikaegis-users route + ikaegis-users.json intentionally UNTOUCHED.');
console.log('Rollback: rename each *.rebrand-bak back over its file.');
