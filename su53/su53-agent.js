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

/* SU53_ACTIVITY_ACCURACY_PATCH */
// role name -> true if it grants every required SU53 field by an EXACT
// value (not a bare '*'). Populated in findMatchingRoles, read in scoreRole.
const EXACT_MATCH_MAP = new Map();

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
  /* SU53_MULTIFIELD_PATCH */
  // Normalise a multi-field SU53 failure. Payload may carry:
  //   - fields: [ {field,value}, ... ]           (new ZKONTROL_SU53)
  //   - field / value                            (old single-field payload)
  var fields = [];
  if (Array.isArray(p.fields)) {
    for (var i = 0; i < p.fields.length; i++) {
      var it = p.fields[i] || {};
      var f = String(it.field || '').toUpperCase().trim();
      var v = String(it.value != null ? it.value : '').toUpperCase().trim();
      if (f) fields.push({ field: f, value: v });
    }
  }
  // fall back to / ensure the single field is present
  var sField = (p.field || '').toUpperCase().trim();
  var sValue = String(p.value != null ? p.value : '').toUpperCase().trim();
  if (sField && !fields.some(function(x){ return x.field === sField; })) {
    fields.push({ field: sField, value: sValue });
  }
  // primary field/value kept for backward compatibility (first entry wins)
  var primary = fields[0] || { field: sField, value: sValue };
  return {
    system:(p.system||'').toUpperCase(), client:String(p.client||''),
    user:(p.user||'').toUpperCase(), tcode:(p.tcode||'').toUpperCase(),
    authObject:(p.authObject||'').toUpperCase(),
    field: primary.field, value: primary.value,
    fields: fields,
    timestamp:p.timestamp||new Date().toISOString(),
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
  /* SU53_AUTH_INSTANCE_PATCH */
  // Per-AUTH-instance matching. SAP grants access only when a SINGLE
  // authorization instance (AGR_1251.AUTH) satisfies EVERY required field.
  // We therefore group role -> AUTH -> field -> [LOW...] and require some
  // instance to grant all fields. Exact-match is evaluated within the same
  // instance. Object-only WHERE keeps it cap-safe (<=72 chars).
  const obj = ctx.authObject.replace(/'/g,"''");

  var required = (Array.isArray(ctx.fields) && ctx.fields.length)
    ? ctx.fields.slice()
    : [{ field: String(ctx.field||'').toUpperCase(), value: String(ctx.value||'').toUpperCase() }];
  required = required.filter(function(x){ return x.field; });

  const rr = await apiPost('/api/rfc/table-read', {
    tableName:'AGR_1251',
    fields:'AGR_NAME,AUTH,OBJECT,FIELD,LOW,HIGH',
    whereClause:"OBJECT = '" + obj + "'",
    maxRows:5000
  });
  const rows = (rr && rr.data) || [];

  // role -> AUTH -> field -> [LOW...]
  const byRole = new Map();
  for (const r of rows) {
    const rn = String(r.AGR_NAME||'');
    if (!rn) continue;
    const auth = String(r.AUTH||'') || '_NOAUTH_';
    const f = String(r.FIELD||'').toUpperCase();
    const low = String(r.LOW||'').toUpperCase();
    if (!byRole.has(rn)) byRole.set(rn, new Map());
    const authMap = byRole.get(rn);
    if (!authMap.has(auth)) authMap.set(auth, new Map());
    const fieldMap = authMap.get(auth);
    if (!fieldMap.has(f)) fieldMap.set(f, []);
    fieldMap.get(f).push(low);
  }

  // does this one instance grant every required field? (wildcard-aware)
  function instanceGrantsAll(fieldMap) {
    return required.every(function(req){
      var lows = fieldMap.get(req.field) || [];
      return lows.some(function(low){ return valueMatches(req.value, low); });
    });
  }
  // does this one instance grant every required field by EXACT value?
  function instanceExactAll(fieldMap) {
    return required.every(function(req){
      var lows = fieldMap.get(req.field) || [];
      return lows.some(function(low){ return valueMatchesExact(req.value, String(low).toUpperCase()); });
    });
  }

  const roles = [];
  if (typeof EXACT_MATCH_MAP !== 'undefined' && EXACT_MATCH_MAP.clear) EXACT_MATCH_MAP.clear();
  byRole.forEach(function(authMap, rn){
    var matched = false;
    var exact = false;
    authMap.forEach(function(fieldMap){
      if (instanceGrantsAll(fieldMap)) {
        matched = true;
        if (instanceExactAll(fieldMap)) exact = true;  // exact within SAME instance
      }
    });
    if (matched) {
      roles.push(rn);
      if (typeof EXACT_MATCH_MAP !== 'undefined' && EXACT_MATCH_MAP.set) {
        try { EXACT_MATCH_MAP.set(rn, exact); } catch(e){}
      }
    }
  });

  /* SAP_ROLE_FILTER: SAP-delivered roles (SAP_*) are standard/template roles,
     not customer-assignable — never suggest them. */
  return roles.filter(function(rn){ return !/^SAP_/i.test(String(rn).trim()); });
}
function valueMatches(req, low) {
  if (!low) return false;
  if (low === '*') return true;
  if (low === req) return true;
  if (low.endsWith('*')) return req.startsWith(low.slice(0,-1));
  return false;
}

/* SU53_ACTIVITY_ACCURACY_PATCH */
// Wildcard-aware but distinguishes an EXACT grant from a '*' grant.
// Returns true only if some LOW equals the requested value literally
// (or a prefix wildcard that isn't the bare '*'). A bare '*' grants
// access but is NOT an exact, least-privilege match.
function valueMatchesExact(req, low) {
  if (!low) return false;
  if (low === '*') return false;            // wildcard grants, but not exact
  if (low === req) return true;             // literal hit
  if (low.endsWith('*')) return req.startsWith(low.slice(0,-1)); // scoped prefix
  return false;
}
// Given the AGR_1251 rows grouped for one role (field -> [LOW,...]),
// decide if EVERY required field is granted by an exact (non-'*') value.
function roleExactForAll(fieldMap, required) {
  return required.every(function(req){
    var lows = fieldMap.get(req.field) || [];
    return lows.some(function(low){ return valueMatchesExact(req.value, String(low).toUpperCase()); });
  });
}

// --- Step 4: enrich + score one candidate ---
function privScore(n){ if(n==null)return 0; if(n<=5)return 3; if(n<=20)return 2; if(n<=100)return 1; return 0; }

// --- wildcard-activity risk (ACTVT='*' = full authorization) ---
async function checkWildcardActivity(role) {
  // cap-safe WHERE (<=72 chars): only this role's ACTVT rows; filter LOW='*' in JS
  try {
    const safe = String(role).replace(/'/g,"''");
    const rr = await apiPost('/api/rfc/table-read', {
      tableName:'AGR_1251', fields:'AGR_NAME,OBJECT,FIELD,LOW',
      whereClause:"AGR_NAME = '" + safe + "' AND FIELD = 'ACTVT'", maxRows:200
    });
    const objs = new Set();
    for (const r of ((rr && rr.data) || [])) {
      if (String(r.LOW||'').trim() === '*') objs.add(String(r.OBJECT||'').toUpperCase());
    }
    return { has: objs.size > 0, objects: Array.from(objs) };
  } catch(e) { return { has:false, objects:[], error:e.message }; }
}

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

  // wildcard-activity risk: role grants ACTVT='*' (full authorization) on some object
  const wildcard = await checkWildcardActivity(role);

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
  // fold wildcard-activity into the risk picture (ACTVT='*' = full access = risk)
  if (wildcard.has) {
    score -= 4; // over-privileged: rank below least-privilege roles
    const shown = wildcard.objects.slice(0,3).join(', ') + (wildcard.objects.length>3 ? ' +'+(wildcard.objects.length-3) : '');
    sod.details = (sod.details||[]).concat([{ riskType:'Critical Permission', riskId:'WILDCARD-ACTVT', desc:'Full activity (ACTVT=*) on '+shown }]);
    if (sod.newCount == null) sod.newCount = 0;
    sod.newCount += 1;
  }
  /* SU53_ACTIVITY_ACCURACY_PATCH */
  // exact vs wildcard-only grant of the failed field(s) (least privilege)
  var exactMatch = EXACT_MATCH_MAP.has(role) ? EXACT_MATCH_MAP.get(role) : null;
  if (exactMatch === true) { score += 2; reasons.push('Exact value match'); }
  else if (exactMatch === false) { score -= 2; reasons.push('Grants via wildcard (broader than needed)'); }

  const clean = sod.newCount === 0;
  if (clean) reasons.push('No new SoD conflict');
  else if (sod.newCount != null) reasons.push(sod.newCount+' new risk(s)'+(wildcard.has?' incl. ACTVT=* full access':''));
  else reasons.push('SoD not verified');

  return { role, module:mod, groupMatch, isCustom, tcodeCount, familiar, sod, clean, wildcard, exactMatch, score, reasons };
}

// --- rank ---
function rank(scored) {
  return scored.slice().sort((a,b)=>{
    if (a.clean !== b.clean) return a.clean ? -1 : 1;          // clean first
    if (a.groupMatch !== b.groupMatch) return a.groupMatch?-1:1; // your module next
    /* SU53_ACTIVITY_ACCURACY_PATCH */
    var ax = a.exactMatch===true?0:(a.exactMatch===false?1:0.5);
    var bx = b.exactMatch===true?0:(b.exactMatch===false?1:0.5);
    if (ax !== bx) return ax - bx;                             // exact-value grant next
    if (b.score !== a.score) return b.score - a.score;          // higher score
    const at=a.tcodeCount==null?1e9:a.tcodeCount, bt=b.tcodeCount==null?1e9:b.tcodeCount;
    if (at!==bt) return at-bt;                                  // fewer tcodes
    return a.role.localeCompare(b.role);
  });
}

function explain(ctx, uc, ranked) {
  /* SU53_MULTIFIELD_PATCH */
  var _fstr = (Array.isArray(ctx.fields) && ctx.fields.length)
    ? ctx.fields.map(function(x){ return x.field+'='+x.value; }).join(', ')
    : (ctx.field+'='+ctx.value);
  if (!ranked.length) return 'No role grants '+ctx.authObject+' ('+_fstr+') in '+ctx.system+'/'+ctx.client+'. A new role or role change may be required.';
  const top = ranked[0];
  const grp = uc.group ? (' [group: '+uc.group+']') : '';
  /* SU53_ACTIVITY_ACCURACY_PATCH */
  var _fstr2 = (Array.isArray(ctx.fields) && ctx.fields.length)
    ? ctx.fields.map(function(x){ return x.field+'='+x.value; }).join(', ')
    : (ctx.field+'='+ctx.value);
  let msg = 'User '+ctx.user+grp+' was denied '+ctx.authObject+' ('+_fstr2+') running '+ctx.tcode+' on '+ctx.system+'/'+ctx.client+'. Best-fit: '+top.role;
  if (top.groupMatch) msg += ' (your module)';
  if (top.clean) msg += ' — no new SoD conflict.'; else if (top.sod.newCount==null) msg += ' — SoD unverified.'; else msg += ' — WARNING '+top.sod.newCount+' new SoD.';
  return msg;
}

/* PRERANK_LAZY_PATCH */
// Cheap ordering with NO API calls. Puts same-module roles first, then Z*
// custom roles, then stable name order. Used to decide which roles are worth
// full (expensive) scoring first, so matching roles like Z_FI_POST are never
// dropped by a blind cap before they are scored.
const TOP_SCORE_COUNT = 40;   // auto-scored on first investigate()
const MORE_BATCH      = 20;   // scored per "See more" click

function cheapPreRank(names, uc) {
  const userMod = uc && uc.module ? String(uc.module).toUpperCase() : null;
  function tier(rn) {
    const mod = roleModule(rn);                 // Z_FI_* -> FI, etc.
    const sameMod = !!(userMod && mod && mod === userMod);
    const isZ = /^Z/i.test(String(rn).trim());
    if (sameMod) return 0;                       // your module first
    if (isZ)     return 1;                        // other custom Z roles
    return 2;                                     // everything else
  }
  return names.slice().sort(function(a, b){
    const ta = tier(a), tb = tier(b);
    if (ta !== tb) return ta - tb;
    return String(a).localeCompare(String(b));
  });
}

// Score a specific list of role names (used by investigate for the top batch
// and by the /score-more route for later batches). Returns ranked scored[].
async function scoreRoleNames(names, ctx, uc) {
  const scored = await Promise.all(names.map(function(r){ return scoreRole(r, ctx, uc); }));
  return rank(scored);
}

// --- orchestrator ---
async function investigate(payload) {
  const ctx = parsePayload(payload);
  const uc  = await getUserContext(ctx.user);
  const matched = await findMatchingRoles(ctx);
  // Cheap pre-rank ALL matches (no API calls), then fully score only the top
  // batch. Remaining names are returned unscored to avoid wasted API calls
  // until the user asks for them ("See more").
  const ordered = cheapPreRank(matched, uc);
  const topNames  = ordered.slice(0, TOP_SCORE_COUNT);
  const pending   = ordered.slice(TOP_SCORE_COUNT);
  const ranked = await scoreRoleNames(topNames, ctx, uc);
  return {
    context: ctx,
    userContext: { group: uc.group, module: uc.module, existingRoleCount: uc.existingRoles.length },
    steps: { matchedRoles: matched, candidatesEvaluated: topNames.length, totalMatched: matched.length },
    suggestions: ranked,
    pendingRoles: pending,          // unscored names, in pre-rank order
    scoredCount: ranked.length,     // how many are scored so far
    totalMatched: matched.length,   // grand total that matched
    moreBatch: MORE_BATCH,          // client hint: how many per "See more"
    explanation: explain(ctx, uc, ranked),
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { investigate, parsePayload, findMatchingRoles, valueMatches, roleModule, userModule, getUserContext, cheapPreRank, scoreRoleNames };
