// patch-su53-wildcard-risk.js
// -------------------------------------------------------------------
// FIX (Issue 3): the SU53 agent never checked whether a suggested role
// grants ACTVT = '*' (full authorization = create/change/post/delete).
// That is an over-privilege / critical-permission risk and must be
// surfaced, not treated as clean.
//
// This patch adds checkWildcardActivity(role) and folds its result into
// scoreRole():
//   - a role with ACTVT='*' on any object gets score -= 4 (ranks lower)
//   - a "Critical Permission" detail is added to sod.details
//   - sod.newCount is bumped so clean=false -> the role renders RED in
//     both su53-agent.html and su53-inbox.html with NO HTML change.
//
// Only su53/su53-agent.js is touched. Existing SoD + matching logic is
// left intact. Safe: backup once (.bak-wildcard), idempotent, aborts
// without writing if any expected anchor is missing.
// NOTE: su53-agent.js is cached in memory -> RESTART the node server
// after applying.
// -------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'su53', 'su53-agent.js');
const BAK  = FILE + '.bak-wildcard';

function fail(msg){ console.error('ABORT: ' + msg); process.exitCode = 1; }

let src;
try { src = fs.readFileSync(FILE, 'utf8'); }
catch (e) { return fail('cannot read ' + FILE + ' -> ' + e.message); }

// ---- idempotency guard ----
if (src.indexOf('checkWildcardActivity') !== -1) {
  console.log('Already patched (found "checkWildcardActivity"). No change made.');
  return;
}

// ===== Edit 1: insert checkWildcardActivity() just before scoreRole() =====
const anchor1 = 'async function scoreRole(role, ctx, uc) {';
const insert1 = [
  "// --- wildcard-activity risk (ACTVT='*' = full authorization) ---",
  'async function checkWildcardActivity(role) {',
  '  // cap-safe WHERE (<=72 chars): only this role\'s ACTVT rows; filter LOW=\'*\' in JS',
  '  try {',
  '    const safe = String(role).replace(/\'/g,"\'\'");',
  "    const rr = await apiPost('/api/rfc/table-read', {",
  "      tableName:'AGR_1251', fields:'AGR_NAME,OBJECT,FIELD,LOW',",
  '      whereClause:"AGR_NAME = \'" + safe + "\' AND FIELD = \'ACTVT\'", maxRows:200',
  '    });',
  '    const objs = new Set();',
  '    for (const r of ((rr && rr.data) || [])) {',
  "      if (String(r.LOW||'').trim() === '*') objs.add(String(r.OBJECT||'').toUpperCase());",
  '    }',
  '    return { has: objs.size > 0, objects: Array.from(objs) };',
  '  } catch(e) { return { has:false, objects:[], error:e.message }; }',
  '}',
  '',
  'async function scoreRole(role, ctx, uc) {'
].join('\n');

// ===== Edit 2: fetch wildcard result after the SoD try/catch =====
const anchor2 = [
  '  } catch(e){ sod = { newCount:null, details:[], error:e.message }; }',
  '',
  '  // familiarity: how many existing user roles share this module'
].join('\n');
const insert2 = [
  '  } catch(e){ sod = { newCount:null, details:[], error:e.message }; }',
  '',
  "  // wildcard-activity risk: role grants ACTVT='*' (full authorization) on some object",
  '  const wildcard = await checkWildcardActivity(role);',
  '',
  '  // familiarity: how many existing user roles share this module'
].join('\n');

// ===== Edit 3: fold wildcard into clean/reasons + return =====
const anchor3 = [
  '  const clean = sod.newCount === 0;',
  "  if (clean) reasons.push('No new SoD conflict');",
  "  else if (sod.newCount==null) reasons.push('SoD not verified');",
  "  else reasons.push(sod.newCount+' new SoD violation(s)');",
  '',
  '  return { role, module:mod, groupMatch, isCustom, tcodeCount, familiar, sod, clean, score, reasons };'
].join('\n');
const insert3 = [
  "  // fold wildcard-activity into the risk picture (ACTVT='*' = full access = risk)",
  '  if (wildcard.has) {',
  '    score -= 4; // over-privileged: rank below least-privilege roles',
  "    const shown = wildcard.objects.slice(0,3).join(', ') + (wildcard.objects.length>3 ? ' +'+(wildcard.objects.length-3) : '');",
  "    sod.details = (sod.details||[]).concat([{ riskType:'Critical Permission', riskId:'WILDCARD-ACTVT', desc:'Full activity (ACTVT=*) on '+shown }]);",
  '    if (sod.newCount == null) sod.newCount = 0;',
  '    sod.newCount += 1;',
  '  }',
  '  const clean = sod.newCount === 0;',
  "  if (clean) reasons.push('No new SoD conflict');",
  "  else if (sod.newCount != null) reasons.push(sod.newCount+' new risk(s)'+(wildcard.has?' incl. ACTVT=* full access':''));",
  "  else reasons.push('SoD not verified');",
  '',
  '  return { role, module:mod, groupMatch, isCustom, tcodeCount, familiar, sod, clean, wildcard, score, reasons };'
].join('\n');

// ---- verify ALL anchors before writing anything ----
if (src.indexOf(anchor1) === -1) return fail('anchor 1 (scoreRole decl) not found. Nothing written.');
if (src.indexOf(anchor2) === -1) return fail('anchor 2 (SoD catch + familiarity) not found. Nothing written. Send: node dump-lines.js su53\\su53-agent.js 118 121');
if (src.indexOf(anchor3) === -1) return fail('anchor 3 (clean/reasons/return) not found. Nothing written. Send: node dump-lines.js su53\\su53-agent.js 133 138');

let out = src.replace(anchor1, insert1).replace(anchor2, insert2).replace(anchor3, insert3);

// ---- backup once, then write ----
try { if (!fs.existsSync(BAK)) fs.writeFileSync(BAK, src, 'utf8'); }
catch (e) { return fail('backup failed -> ' + e.message); }

try { fs.writeFileSync(FILE, out, 'utf8'); }
catch (e) { return fail('write failed -> ' + e.message); }

console.log('OK: su53/su53-agent.js patched.');
console.log(' - checkWildcardActivity() added (AGR_1251, FIELD=ACTVT, LOW=*)');
console.log(' - ACTVT=* roles now flagged Critical Permission, score -4, clean=false (red)');
console.log('Backup: ' + BAK);
console.log('>> RESTART the node server (agent is cached in memory).');
