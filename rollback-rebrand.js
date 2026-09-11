#!/usr/bin/env node
/* IK° Kontrol rebrand — rollback: restore every *.rebrand-bak over its file */
'use strict';
const fs = require('fs');
const path = require('path');
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.rebrand-bak')) out.push(p);
  }
}
const baks = [];
walk(process.cwd(), baks);
if (!baks.length) { console.log('No .rebrand-bak files found — nothing to roll back.'); process.exit(0); }
let n = 0;
for (const bak of baks) {
  const target = bak.replace(/\.rebrand-bak$/, '');
  fs.copyFileSync(bak, target);
  console.log('  restored: ' + path.relative(process.cwd(), target));
  n++;
}
console.log('\nRolled back ' + n + ' file(s). (.rebrand-bak files kept — delete manually if desired.)');
