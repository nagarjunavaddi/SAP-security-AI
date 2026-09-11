#!/usr/bin/env node
/* IK° Kontrol rebrand — SOD.html export-filename follow-up
   Fixes the 3 remaining IKAegis_SoD_ export filename variants. */
'use strict';
const fs = require('fs');
const path = require('path');
const rel = 'SOD.html';
const abs = path.join(process.cwd(), rel);
if (!fs.existsSync(abs)) { console.log('[skip] not found: ' + rel); process.exit(0); }
let src = fs.readFileSync(abs, 'utf8');
const orig = src;
const pairs = [
  ["'IKAegis_SoD_BulkRoles_'", "'IKKontrol_SoD_BulkRoles_'"],
  ["'IKAegis_SoD_User_'", "'IKKontrol_SoD_User_'"],
  ["'IKAegis_SoD_BulkUsers_'", "'IKKontrol_SoD_BulkUsers_'"],
];
let hits = 0;
for (const [f, t] of pairs) { if (src.indexOf(f) !== -1) { src = src.split(f).join(t); hits++; } }
if (src === orig) { console.log('[ok/idempotent] no change: ' + rel); }
else {
  const bak = abs + '.rebrand-bak';
  if (!fs.existsSync(bak)) { fs.writeFileSync(bak, orig, 'utf8'); console.log('[backup] ' + rel + '.rebrand-bak'); }
  else console.log('[backup exists, kept] ' + rel + '.rebrand-bak');
  fs.writeFileSync(abs, src, 'utf8');
  console.log('[PATCHED] ' + rel + '  (' + hits + ' replacement group(s))');
}
// verify
const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
let rem = 0;
lines.forEach((ln, i) => {
  if (ln.indexOf('IKAegis') === -1) return;
  if (ln.indexOf('ikaegis-users') !== -1 || ln.indexOf('// IKAegis') !== -1 || ln.indexOf('IKAegis Enterprise Design System') !== -1) return;
  rem++; console.log('  ' + rel + ':' + (i + 1) + '  ' + ln.trim().slice(0, 90));
});
console.log('Remaining visible "IKAegis" in ' + rel + ': ' + rem + (rem === 0 ? '  ✓ clean' : ''));
