/**
 * patch-composite-roles.js
 * ---------------------------------------------------------------------------
 * Wires composite role support in. Four surgical edits, each ONE line:
 *
 *   1. server.js            - mount routes/composite-routes.js, right after
 *                             app.assignSapRole is defined (order matters).
 *   2. approval-routes.js   - approval now calls assignSapRoleSmart when it
 *                             exists, otherwise the original assignSapRole.
 *   3. approval-config.html - role validation uses /api/sap-role-check-v2/
 *   4. new-request.html     - role validation uses /api/sap-role-check-v2/
 *
 * Every step: backup, idempotency marker, verification. A step already
 * applied is skipped. If any verification fails, ALL files are rolled back.
 *
 * Usage:  node patch-composite-roles.js
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const originals = {};   // path -> original text, for rollback
const done = [];
const skipped = [];

function read(p) {
  if (!fs.existsSync(p)) throw new Error('not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}

function rollbackAll() {
  Object.keys(originals).forEach(function (p) {
    fs.writeFileSync(p, originals[p], 'utf8');
  });
}

function fail(msg) {
  rollbackAll();
  console.error('\n  FAILED: ' + msg);
  console.error('  All files rolled back. Nothing changed.\n');
  process.exit(1);
}

/**
 * One idempotent single-line edit.
 *   find    - exact text that must exist once
 *   replace - what it becomes
 *   marker  - if present in the file, this step is already done
 */
function step(label, file, find, replace, marker) {
  const p = path.join(__dirname, file);
  let txt;
  try { txt = read(p); } catch (e) { fail(e.message); }

  if (txt.indexOf(marker) !== -1) {
    skipped.push(label);
    console.log('  [SKIP] ' + label + ' - already applied');
    return;
  }

  const hits = txt.split(find).length - 1;
  if (hits === 0) fail(label + ': anchor not found in ' + file + '\n         looking for: ' + find);
  if (hits > 1) fail(label + ': anchor appears ' + hits + ' times in ' + file + ' - refusing to guess.');

  if (!originals[p]) {
    originals[p] = txt;
    fs.writeFileSync(p + '.bak-' + stamp, txt, 'utf8');
  }

  fs.writeFileSync(p, txt.replace(find, replace), 'utf8');
  done.push(label);
  console.log('  [ OK ] ' + label);
}

console.log('\n  IK Kontrol - composite role support');
console.log('  ' + '-'.repeat(52));

/* Prerequisites -------------------------------------------------------- */

['sap-composite.js', 'routes/composite-routes.js'].forEach(function (f) {
  if (!fs.existsSync(path.join(__dirname, f))) {
    console.error('\n  FAILED: ' + f + ' is missing.');
    console.error('  Copy both new files into the project first, then re-run.\n');
    process.exit(1);
  }
});

/* 1. server.js --------------------------------------------------------- */

step(
  'server.js: mount composite routes',
  'server.js',
  "require('./routes/user-create-requests')(app);",
  "require('./routes/user-create-requests')(app); app.getRoleTcodes = getRoleTcodesFromSAP; require('./routes/composite-routes')(app); /* IK-COMPOSITE */",
  'IK-COMPOSITE'
);

/* 2. approval-routes.js ------------------------------------------------ */

step(
  'approval-routes.js: composite-aware assignment',
  'routes/approval-routes.js',
  'const result = await app.assignSapRole(sapUser, request.role);',
  'const result = await (app.assignSapRoleSmart || app.assignSapRole)(sapUser, request.role); /* IK-COMPOSITE-ASSIGN */',
  'IK-COMPOSITE-ASSIGN'
);

/* 3 + 4. frontend role validation -------------------------------------- */

step(
  'approval-config.html: role check v2',
  'approval-config.html',
  "fetch('/api/sap-role-check/'+encodeURIComponent(r))",
  "fetch('/api/sap-role-check-v2/'+encodeURIComponent(r))/* IK-COMPOSITE-CHK */",
  'IK-COMPOSITE-CHK'
);

step(
  'new-request.html: role check v2',
  'new-request.html',
  "fetch('/api/sap-role-check/'+encodeURIComponent(payload.roleName))",
  "fetch('/api/sap-role-check-v2/'+encodeURIComponent(payload.roleName))/* IK-COMPOSITE-CHK */",
  'IK-COMPOSITE-CHK'
);

/* Verification --------------------------------------------------------- */

console.log('  ' + '-'.repeat(52));

const checks = [
  ['composite routes mounted', 'server.js', "require('./routes/composite-routes')(app)"],
  ['getRoleTcodes exposed', 'server.js', 'app.getRoleTcodes = getRoleTcodesFromSAP'],
  ['user-create still mounted', 'server.js', "require('./routes/user-create-requests')(app)"],
  ['approval-routes still mounted', 'server.js', "require('./routes/approval-routes')(app)"],
  ['assignSapRole still defined', 'server.js', 'app.assignSapRole = assignSapRoleInSAP'],
  ['smart assign in approvals', 'routes/approval-routes.js', 'assignSapRoleSmart || app.assignSapRole'],
  ['approval-routes intact', 'routes/approval-routes.js', "app.put('/api/approval-requests/:id'"],
  ['config page uses v2', 'approval-config.html', '/api/sap-role-check-v2/'],
  ['request page uses v2', 'new-request.html', '/api/sap-role-check-v2/'],
  ['user check untouched', 'approval-config.html', '/api/sap-user-check/']
];

let allOk = true;
checks.forEach(function (c) {
  let ok = false;
  try { ok = read(path.join(__dirname, c[1])).indexOf(c[2]) !== -1; } catch (e) { ok = false; }
  console.log('  [' + (ok ? 'OK  ' : 'FAIL') + '] ' + c[0]);
  if (!ok) allOk = false;
});

if (!allOk) fail('verification failed.');

/* Syntax check on the two JS files we touched */
['server.js', 'routes/composite-routes.js', 'sap-composite.js', 'routes/approval-routes.js'].forEach(function (f) {
  try {
    new (require('vm').Script)(read(path.join(__dirname, f)), { filename: f });
    console.log('  [OK  ] parses: ' + f);
  } catch (e) {
    fail('syntax error in ' + f + ': ' + e.message);
  }
});

console.log('  ' + '-'.repeat(52));
if (done.length) console.log('  Applied : ' + done.length);
if (skipped.length) console.log('  Skipped : ' + skipped.length + ' (already applied)');
console.log('\n  Restart the server:  node server.js');
if (Object.keys(originals).length) {
  console.log('\n  Rollback if needed:');
  Object.keys(originals).forEach(function (p) {
    console.log('    copy /Y "' + p + '.bak-' + stamp + '" "' + p + '"');
  });
}
console.log('');
