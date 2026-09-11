#!/usr/bin/env node
/* ============================================================
   IK° Kontrol — Brandmark follow-up patch
   Fixes SPLIT brand markup that plain "IKAegis" search missed:
     A) <span class="ik-gold">IK</span>Aegis
     B) IK<span class="ik-gold">Aegis</span>
     C) <span class="ik-gold">IK</span><span style="color:#EEF1F6">Aegis</span>
     D) <span style="color:#FFC000;">IK</span>Aegis   (email HTML)
   -> IK<span class="ik-gold">°</span> Kontrol  (degree gold, matches su53-inbox)
      (email keeps inline color: IK<span style="color:#FFC000;">°</span> Kontrol)
   Backup + idempotent. Never touches ikaegis-users route/json.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

// HTML brand target (uses existing .ik-gold class for the degree)
const H = 'IK<span class="ik-gold">\u00b0</span> Kontrol';
// Email brand target (inline gold, no external CSS in email clients)
const E = 'IK<span style="color:#FFC000;">\u00b0</span> Kontrol';

const PLAN = {
  'index.html': [
    ['<span class="ik-gold">IK</span>Aegis', H],
  ],
  'approval-config.html': [
    ['<span class="ik-gold">IK</span>Aegis', H],
    ['<span class="ik-gold">IK</span><span style="color:#EEF1F6">Aegis</span>', H],
  ],
  'approvals.html': [
    ['<span class="ik-gold">IK</span>Aegis', H],
  ],
  'audit-log.html': [
    ['<span class="ik-gold">IK</span>Aegis', H],
  ],
  'create-user.html': [
    ['<span class="ik-gold">IK</span>Aegis', H],
  ],
  'new-request.html': [
    ['<span class="ik-gold">IK</span>Aegis', H],
  ],
  'risk-analysis.html': [
    ['<span class="ik-gold">IK</span>Aegis', H],
  ],
  'simulation.html': [
    ['<span class="ik-gold">IK</span>Aegis', H],
  ],
  'SOD.html': [
    ['<span class="ik-gold">IK</span>Aegis', H],
  ],
  'login.html': [
    ['<span class="ik-gold">IK</span>Aegis', H],
  ],
  // Pattern B (reversed)
  'reports-hub.html': [
    ['IK<span class="ik-gold">Aegis</span>', H],
  ],
  'requests-hub.html': [
    ['IK<span class="ik-gold">Aegis</span>', H],
  ],
  'reviews-hub.html': [
    ['IK<span class="ik-gold">Aegis</span>', H],
  ],
  'risk-hub.html': [
    ['IK<span class="ik-gold">Aegis</span>', H],
  ],
  'uar-admin.html': [
    ['IK<span class="ik-gold">Aegis</span>', H],
  ],
  'uar-inbox.html': [
    ['IK<span class="ik-gold">Aegis</span>', H],
  ],
  // Pattern D (email)
  'email-service.js': [
    ['<span style="color:#FFC000;">IK</span>Aegis', E],
  ],
};

function applyFile(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { console.log('  [skip] not found: ' + rel); return false; }
  let src = fs.readFileSync(abs, 'utf8');
  const orig = src;
  let hits = 0;
  for (const [from, to] of PLAN[rel]) {
    if (src.indexOf(from) !== -1) {
      const before = src.length;
      src = src.split(from).join(to);
      hits += (orig.split(from).length - 1) || 1;
    }
  }
  if (src === orig) { console.log('  [ok/idempotent] no change: ' + rel); return false; }
  const bak = abs + '.brandmark-bak';
  if (!fs.existsSync(bak)) { fs.writeFileSync(bak, orig, 'utf8'); console.log('  [backup] ' + rel + '.brandmark-bak'); }
  else console.log('  [backup exists, kept] ' + rel + '.brandmark-bak');
  fs.writeFileSync(abs, src, 'utf8');
  console.log('  [PATCHED] ' + rel + '  (' + hits + ' spot(s))');
  return true;
}

console.log('== IK\u00b0 Kontrol brandmark patch ==');
console.log('root: ' + ROOT + '\n');
let changed = 0;
for (const rel of Object.keys(PLAN)) if (applyFile(rel)) changed++;

// verification: any remaining split "Aegis" in these files?
console.log('\n-- verification: remaining ">Aegis" / "Aegis<" brand fragments --');
let rem = 0;
for (const rel of Object.keys(PLAN)) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
  lines.forEach((ln, i) => {
    // only flag brand-mark fragments, not CSS class names like .footer-aegis
    if (/>Aegis|Aegis<\/span>|>IK<\/span>Aegis/.test(ln)) {
      rem++; console.log('  ' + rel + ':' + (i + 1) + '  ' + ln.trim().slice(0, 90));
    }
  });
}
console.log('\nFiles patched: ' + changed);
console.log('Remaining brand fragments: ' + rem + (rem === 0 ? '  \u2713 clean' : '  (review above)'));
console.log('\nNote: .footer-aegis CSS class name left as-is (invisible, harmless).');
console.log('Rollback: restore *.brandmark-bak over each file.');
