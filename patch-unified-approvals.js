/**
 * patch-unified-approvals.js
 * ---------------------------------------------------------------------------
 * Adds the Unified Approval Queue to approvals.html.
 *
 * Touches approvals.html with exactly TWO insertions. Nothing is modified,
 * reordered or deleted:
 *   1. <div id="ikUnifiedRoot"></div>  immediately BEFORE the existing
 *      "Requests" section header.
 *   2. <script src="unified-approvals.js"></script> immediately BEFORE </body>.
 *
 * Safe to run repeatedly: a marker comment makes it idempotent.
 * Creates a timestamped .bak before writing, and verifies after writing.
 *
 * Usage:  node patch-unified-approvals.js
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'approvals.html');
const ASSET = path.join(__dirname, 'unified-approvals.js');
const MARKER = 'IK-UNIFIED-QUEUE';

const ANCHOR_ROOT = '<div class="section-header"><h2>Requests</h2><div class="section-line"></div></div>';
const ANCHOR_BODY = '</body>';

const ROOT_BLOCK =
  '  <!-- ' + MARKER + ' : mount point (additive) -->\n' +
  '  <div id="ikUnifiedRoot"></div>\n';

const SCRIPT_BLOCK =
  '<!-- ' + MARKER + ' : additive module, legacy script above is untouched -->\n' +
  '<script src="unified-approvals.js"></script>\n';

function fail(msg) {
  console.error('\n  FAILED: ' + msg + '\n  No changes were written.\n');
  process.exit(1);
}

console.log('\n  IK Kontrol - unified approval queue patch');
console.log('  ' + '-'.repeat(48));

/* ---------------------------------------------------------- pre-flight */

if (!fs.existsSync(TARGET)) fail('approvals.html not found at ' + TARGET);
if (!fs.existsSync(ASSET)) {
  fail('unified-approvals.js not found at ' + ASSET +
    '\n  Copy it into the project folder first, then re-run this patch.');
}

let html = fs.readFileSync(TARGET, 'utf8');
console.log('  Target      : approvals.html (' + html.length + ' bytes)');

/* --------------------------------------------------------- idempotency */

if (html.indexOf(MARKER) !== -1) {
  console.log('  Status      : already patched (marker found)');
  console.log('  Nothing to do. approvals.html left untouched.\n');
  process.exit(0);
}

/* ------------------------------------------------------ anchor checks */

if (html.indexOf(ANCHOR_ROOT) === -1) {
  fail('mount anchor not found. Expected this line in approvals.html:\n         ' + ANCHOR_ROOT);
}
if (html.split(ANCHOR_ROOT).length - 1 !== 1) {
  fail('mount anchor appears more than once - refusing to guess which one.');
}
if (html.lastIndexOf(ANCHOR_BODY) === -1) {
  fail('</body> not found in approvals.html.');
}
console.log('  Anchors     : both found, each unique');

/* ---------------------------------------------------------- backup */

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const backup = TARGET + '.bak-' + stamp;
fs.writeFileSync(backup, html, 'utf8');
console.log('  Backup      : ' + path.basename(backup));

/* ----------------------------------------------------------- patch */

let out = html.replace(ANCHOR_ROOT, ROOT_BLOCK + '  ' + ANCHOR_ROOT);

const bodyAt = out.lastIndexOf(ANCHOR_BODY);
out = out.slice(0, bodyAt) + SCRIPT_BLOCK + out.slice(bodyAt);

fs.writeFileSync(TARGET, out, 'utf8');

/* ---------------------------------------------------------- verify */

const check = fs.readFileSync(TARGET, 'utf8');
const tests = [
  ['mount div present', check.indexOf('id="ikUnifiedRoot"') !== -1],
  ['script tag present', check.indexOf('src="unified-approvals.js"') !== -1],
  ['marker present', check.indexOf(MARKER) !== -1],
  ['legacy loadRequests intact', check.indexOf("fetch('/api/approval-requests')") !== -1],
  ['legacy _doAction intact', check.indexOf('window._doAction = function') !== -1],
  ['legacy renderTable intact', check.indexOf('function renderTable()') !== -1],
  ['legacy modal intact', check.indexOf('id="actionModal"') !== -1],
  ['file grew, nothing lost', check.length > html.length]
];

console.log('  ' + '-'.repeat(48));
let ok = true;
tests.forEach(function (t) {
  console.log('  [' + (t[1] ? 'OK  ' : 'FAIL') + '] ' + t[0]);
  if (!t[1]) ok = false;
});

if (!ok) {
  fs.writeFileSync(TARGET, html, 'utf8');
  fail('verification failed - approvals.html rolled back from memory.');
}

console.log('  ' + '-'.repeat(48));
console.log('  Patched OK. Restart the server, then open approvals.html.');
console.log('  Rollback if needed:');
console.log('    copy /Y "' + backup + '" "' + TARGET + '"\n');
