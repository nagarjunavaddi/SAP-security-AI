/**
 * sap-composite.js
 * ---------------------------------------------------------------------------
 * Composite role support for IK Kontrol.
 *
 * Why this exists
 * ---------------
 * /api/sap-role-check used getRoleTcodesFromSAP(), which reads RoleTcodeSet
 * (AGR_TCODES-style data). A COMPOSITE role holds no transactions of its own -
 * its transactions live in its child single roles - so that lookup returns an
 * empty array and the role is reported as "not found in SAP system", even
 * though it exists. This module checks the role directory itself instead.
 *
 * How
 * ---
 * Reuses the SEGW entity already exposed by ZUSER_LOCK_SRV_SRV:
 * GenericTableReadSet (POST TableName / Fields / WhereClause / MaxRows).
 * NO SEGW change is needed.
 *
 *   AGR_DEFINE  -> does the role exist at all
 *   AGR_AGRS    -> AGR_NAME (composite) to CHILD_AGR (single role) mapping
 *
 * A role with rows in AGR_AGRS is composite; the child roles are what gets
 * assigned to the user on approval.
 *
 * 100% NEW FILE. Nothing existing is edited by this file.
 * ---------------------------------------------------------------------------
 */

const https = require('https');

/* Same target as server.js. Env vars win if present, so nothing breaks when
   the connection details move into .env later. */
const SAP = {
  hostname: process.env.SAP_HOST || 's4hana2020.support.com',
  port: process.env.SAP_PORT || 8009,
  client: process.env.SAP_CLIENT || '800',
  username: process.env.SAP_USER || 'best',
  password: process.env.SAP_PASS || 'Welcome123'
};

const SRV = '/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV';

/* Small cache so a page with many roles doesn't hammer SAP. */
const cache = new Map();
const TTL_MS = 5 * 60 * 1000;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) { cache.delete(key); return null; }
  return hit.val;
}
function cacheSet(key, val) { cache.set(key, { at: Date.now(), val: val }); }

/* ------------------------------------------------------------------ CSRF */

function getCsrf() {
  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname: SAP.hostname,
      port: SAP.port,
      path: SRV + '/?sap-client=' + SAP.client,
      method: 'GET',
      auth: SAP.username + ':' + SAP.password,
      headers: { 'X-CSRF-Token': 'Fetch' },
      rejectUnauthorized: false
    }, (res) => {
      let b = '';
      res.on('data', c => { b += c; });
      res.on('end', () => {
        resolve({
          token: res.headers['x-csrf-token'],
          cookies: (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ')
        });
      });
    });
    r.on('error', reject);
    r.end();
  });
}

/* ------------------------------------------------------- generic read */

function genericTableRead(tableName, fields, whereClause, maxRows) {
  return new Promise(async (resolve, reject) => {
    try {
      const { token, cookies } = await getCsrf();
      const payload = JSON.stringify({
        TableName: tableName,
        Fields: fields,
        WhereClause: whereClause,
        MaxRows: String(maxRows || 200),
        ResultData: ''
      });

      const req = https.request({
        hostname: SAP.hostname,
        port: SAP.port,
        path: SRV + '/GenericTableReadSet?sap-client=' + SAP.client,
        method: 'POST',
        auth: SAP.username + ':' + SAP.password,
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-CSRF-Token': token,
          'Cookie': cookies,
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let d = '';
        res.on('data', c => { d += c; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(d);
            const rd = (parsed.d && (parsed.d.ResultData || parsed.d.resultdata)) || '[]';
            resolve(JSON.parse(rd));
          } catch (e) {
            resolve([]);
          }
        });
      });

      req.on('error', reject);
      req.write(payload);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/* Field names come back in whatever case the ABAP layer emits. */
function pick(row, name) {
  if (!row) return '';
  const keys = Object.keys(row);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toUpperCase() === name.toUpperCase()) return String(row[keys[i]] || '').trim();
  }
  return '';
}

function sanitise(roleName) {
  /* Role names are SAP identifiers - keep it to safe characters so the value
     can't break out of the WHERE clause. */
  return String(roleName || '').toUpperCase().replace(/[^A-Z0-9_\/\-.]/g, '');
}

/* --------------------------------------------------------------- API */

/** Child single roles of a composite. Empty array = not composite. */
async function getChildRoles(roleName) {
  const role = sanitise(roleName);
  if (!role) return [];

  const key = 'children:' + role;
  const hit = cacheGet(key);
  if (hit) return hit;

  const rows = await genericTableRead(
    'AGR_AGRS', 'AGR_NAME,CHILD_AGR', "AGR_NAME = '" + role + "'", 500
  );

  const children = rows
    .map(r => pick(r, 'CHILD_AGR'))
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);

  cacheSet(key, children);
  return children;
}

/** Does the role exist in AGR_DEFINE (single OR composite)? */
async function roleExistsInDirectory(roleName) {
  const role = sanitise(roleName);
  if (!role) return false;

  const key = 'exists:' + role;
  const hit = cacheGet(key);
  if (hit !== null) return hit;

  const rows = await genericTableRead(
    'AGR_DEFINE', 'AGR_NAME', "AGR_NAME = '" + role + "'", 1
  );
  const exists = rows.length > 0;
  cacheSet(key, exists);
  return exists;
}

/**
 * Full picture for one role.
 * -> { exists, isComposite, childRoles, roleName }
 */
async function describeRole(roleName) {
  const role = sanitise(roleName);
  const children = await getChildRoles(role);

  if (children.length > 0) {
    return { roleName: role, exists: true, isComposite: true, childRoles: children };
  }

  const exists = await roleExistsInDirectory(role);
  return { roleName: role, exists: exists, isComposite: false, childRoles: [] };
}

/**
 * What should actually be assigned in SAP for this role?
 * Composite -> its child single roles. Single -> itself.
 */
async function expandForAssignment(roleName) {
  const info = await describeRole(roleName);
  return info.isComposite ? info.childRoles : [info.roleName];
}

module.exports = {
  genericTableRead,
  getChildRoles,
  roleExistsInDirectory,
  describeRole,
  expandForAssignment
};
