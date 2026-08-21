// su53-agent.js  (PRODUCTION v2 — 5-factor scoring)
// Data layer reuses existing product APIs (no server.js change, HTTP self-call).
//   AGR_1251  role->auth  via POST /api/rfc/table-read
//   USR02     user group  via POST /api/rfc/table-read
//   AGR_USERS user roles  via POST /api/rfc/table-read
//   tcode cnt              via GET  /api/sap-role-check/:role  (returns tcodeCount)
//   SoD                    via POST /api/simulation/user
const BASE = process.env.SU53_BASE || 'http://localhost:3000';

// --- config: user-group -> module code, and role naming -> module ---
const GROUP_MODULE = {
  FINANCE:'FI', FI:'FI', ACCOUNTING:'FI',
  SD:'SD', SALES:'SD',
  MM:'MM', MATERIALS:'MM', PURCHASING:'MM',
};
const PREFER_CUSTOM = true;   // org builds its own Z_* roles

function roleModule(role) {
  const m = String(role).toUpperCase().match(/^Z_(FI|SD|MM)_/);
  return m ? m[1] : null;
}
function userModule(groupClass) {
  if (!groupClass) return null;
  return GROUP_MODULE[String(groupClass).toUpperCase()] || null;
}

async function apiPost(path, body) {
  const res = await fetch(BASE + path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const t = await res.text(); let d; try { d = JSON.parse(t); } catch(e){ d = t; }
  if (!res.ok) throw new Error('API '+path+' -> '+res.status+': '+(d&&d.error?d.error:t.slice(0,150)));
  return d;
}
async function apiGet(path) {
  const res = await fetch(BASE + path);
  const t = await res.text(); let d; try { d = JSON.parse(t); } catch(e){ d = t; }
  if (!res.ok) throw new Error('API '+path+' -> '+res.status);
  return d;
}

// --- Step 1: parse ---
function parsePayload(p) {
  return {
    system:(p.system||'').toUpperCase(), client:String(p.client||''),
    user:(p.user||'').toUpperCase(), tcode:(p.tcode||'').toUpperCase(),
    authObject:(p.authObject||'').toUpperCase(), field:(p.field||'').toUpperCase(),
    value:String(p.value||'').toUpperCase(), timestamp:p.timestamp||new Date().toISOString(),
  };
}

// --- Step 2: user context (group + existing roles) — fetched ONCE ---
async function getUserContext(user) {
  let group = null, existingRoles = [];
  try {
    const g = await apiPost('/api/rfc/table-read', { tableName:'USR02', fields:'BNAME,CLASS', whereClause:"BNAME = '"+user.replace(/'/g,"''")+"'", maxRows:1 });
    const row = (g.data||[])[0]; if (row) group = String(row.CLASS||'').trim() || null;
  } catch(e){}
  try {
    const r = await apiPost('/api/rfc/table-read', { tableName:'AGR_USERS', fields:'AGR_NAME,UNAME', whereClause:"UNAME = '"+user.replace(/'/g,"''")+"'", maxRows:500 });
    existingRoles = Array.from(new Set((r.data||[]).map(x=>String(x.AGR_NAME).toUpperCase())));
  } catch(e){}
  return { group, module:userModule(group), existingRoles, existingModules:existingRoles.map(roleModule).filter(Boolean) };
}

// --- Step 3: matching roles (AGR_1251, wildcard-aware) ---
async function findMatchingRoles(ctx) {
  // [twoqueries-fix] two short cap-safe queries (RFC_READ_TABLE OPTIONS = 72 chars/line):
  //   Q1 exact value, Q2 full wildcard '*'. Merge rows, then JS filter below.
  const obj = ctx.authObject.replace(/'/g,"''");
  const val = String(ctx.value||'').replace(/'/g,"''");
  const q = async (w) => {
    const rr = await apiPost('/api/rfc/table-read', { tableName:'AGR_1251', fields:'AGR_NAME,OBJECT,FIELD,LOW,HIGH', whereClause:w, maxRows:500 });
    return (rr && rr.data) || [];
  };
  let rows = [];
  if (val) {
    rows = rows.concat(await q("OBJECT = '" + obj + "' AND LOW = '" + val + "'"));
    rows = rows.concat(await q("OBJECT = '" + obj + "' AND LOW = '*'"));
  } else {
    rows = await q("OBJECT = '" + obj + "'");
  }
  const resp = { data: rows };
  const roles = new Set();
  for (const r of (resp.data||[])) {
    const f = String(r.FIELD||'').toUpperCase();
    const wantField = String(ctx.field||'').toUpperCase();
    if (f && wantField && f !== wantField) continue;
    if (valueMatches(ctx.value, String(r.LOW||'').toUpperCase())) roles.add(r.AGR_NAME);
  }
  return Array.from(roles);
}
function valueMatches(req, low) {
  if (!low) return false;
  if (low === '*') return true;
  if (low === req) return true;
  if (low.endsWith('*')) return req.startsWith(low.slice(0,-1));
  return false;
}

// --- Step 4: enrich + score one candidate ---
function privScore(n){ if(n==null)return 0; if(n<=5)return 3; if(n<=20)return 2; if(n<=100)return 1; return 0; }

async function scoreRole(role, ctx, uc) {
  const mod = roleModule(role);
  const groupMatch = !!(uc.module && mod && uc.module === mod);
  const isCustom = /^Z/i.test(role);

  // tcode count (least privilege)
  let tcodeCount = null;
  try { const c = await apiGet('/api/sap-role-check/'+encodeURIComponent(role)); if (c && typeof c.tcodeCount==='number') tcodeCount = c.tcodeCount; } catch(e){}

  // SoD (new violations if added to user)
  let sod = { newCount:null, details:[] };
  try {
    const sim = await apiPost('/api/simulation/user', { username:ctx.user, proposedRoles:[role] });
    const nv = (sim.violations||[]).filter(v=>v.simulationFlag==='NEW');
    sod = { newCount: sim.newViolationCount!=null?sim.newViolationCount:nv.length,
            details: nv.map(v=>({riskType:v.riskType, riskId:v.riskId, desc:v.riskDescription||v.description||v.riskId})) };
  } catch(e){ sod = { newCount:null, details:[], error:e.message }; }

  // familiarity: how many existing user roles share this module
  const familiar = mod ? uc.existingModules.filter(m=>m===mod).length : 0;

  // composite score
  let score = 0; const reasons = [];
  if (groupMatch) { score += 5; reasons.push('In your module ('+mod+')'); }
  else if (mod)   { reasons.push('Different module ('+mod+')'); }
  const ps = privScore(tcodeCount);
  score += ps;
  if (tcodeCount!=null) reasons.push('Least privilege ('+tcodeCount+' tcodes)');
  const fam = Math.min(familiar,2); score += fam;
  if (familiar>0) reasons.push('You already hold '+familiar+' '+mod+' role(s)');
  if (isCustom && PREFER_CUSTOM) { score += 1; reasons.push('Custom (Z) role'); }
  const clean = sod.newCount === 0;
  if (clean) reasons.push('No new SoD conflict');
  else if (sod.newCount==null) reasons.push('SoD not verified');
  else reasons.push(sod.newCount+' new SoD violation(s)');

  return { role, module:mod, groupMatch, isCustom, tcodeCount, familiar, sod, clean, score, reasons };
}

// --- rank ---
function rank(scored) {
  return scored.slice().sort((a,b)=>{
    if (a.clean !== b.clean) return a.clean ? -1 : 1;          // clean first
    if (a.groupMatch !== b.groupMatch) return a.groupMatch?-1:1; // your module next
    if (b.score !== a.score) return b.score - a.score;          // higher score
    const at=a.tcodeCount==null?1e9:a.tcodeCount, bt=b.tcodeCount==null?1e9:b.tcodeCount;
    if (at!==bt) return at-bt;                                  // fewer tcodes
    return a.role.localeCompare(b.role);
  });
}

function explain(ctx, uc, ranked) {
  if (!ranked.length) return 'No role grants '+ctx.authObject+' ('+ctx.field+'='+ctx.value+') in '+ctx.system+'/'+ctx.client+'. A new role or role change may be required.';
  const top = ranked[0];
  const grp = uc.group ? (' [group: '+uc.group+']') : '';
  let msg = 'User '+ctx.user+grp+' was denied '+ctx.authObject+' ('+ctx.field+'='+ctx.value+') running '+ctx.tcode+' on '+ctx.system+'/'+ctx.client+'. Best-fit: '+top.role;
  if (top.groupMatch) msg += ' (your module)';
  if (top.clean) msg += ' — no new SoD conflict.'; else if (top.sod.newCount==null) msg += ' — SoD unverified.'; else msg += ' — WARNING '+top.sod.newCount+' new SoD.';
  return msg;
}

// --- orchestrator ---
async function investigate(payload) {
  const ctx = parsePayload(payload);
  const uc  = await getUserContext(ctx.user);
  const matched = await findMatchingRoles(ctx);
  const cap = matched.slice(0, 25); // bound self-calls
  const scored = await Promise.all(cap.map(r => scoreRole(r, ctx, uc)));
  const ranked = rank(scored);
  return {
    context: ctx,
    userContext: { group: uc.group, module: uc.module, existingRoleCount: uc.existingRoles.length },
    steps: { matchedRoles: matched, candidatesEvaluated: cap.length },
    suggestions: ranked,
    explanation: explain(ctx, uc, ranked),
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { investigate, parsePayload, findMatchingRoles, valueMatches, roleModule, userModule };
