// sap-uar.js  (v2 - adds removeSapRole)
const https = require('https');

const SAP_CONFIG = {
  hostname: 's4hana2020.support.com',
  port: 8009,
  client: '800',
  username: 'best',
  password: 'Welcome123'
};

function getCsrfToken() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SAP_CONFIG.hostname,
      port: SAP_CONFIG.port,
      path: '/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/?sap-client=' + SAP_CONFIG.client,
      method: 'GET',
      auth: SAP_CONFIG.username + ':' + SAP_CONFIG.password,
      headers: { 'X-CSRF-Token': 'Fetch' },
      rejectUnauthorized: false
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ token: res.headers['x-csrf-token'], cookies: res.headers['set-cookie'] || [] }));
    });
    req.on('error', reject);
    req.end();
  });
}

function sapPost(path, payload, csrf) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const cookieStr = csrf.cookies.map(c => c.split(';')[0]).join('; ');
    const options = {
      hostname: SAP_CONFIG.hostname,
      port: SAP_CONFIG.port,
      path: path,
      method: 'POST',
      auth: SAP_CONFIG.username + ':' + SAP_CONFIG.password,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-CSRF-Token': csrf.token,
        'Cookie': cookieStr,
        'Content-Length': Buffer.byteLength(data)
      },
      rejectUnauthorized: false
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getAllAssignments() {
  const csrf = await getCsrfToken();
  const payload = { TableName: 'AGR_USERS', Fields: 'UNAME,AGR_NAME', WhereClause: '', MaxRows: '50000', ResultData: '' };
  const result = await sapPost('/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/GenericTableReadSet?sap-client=' + SAP_CONFIG.client, payload, csrf);
  if (result.status !== 201) {
    const msg = (result.data && result.data.error && result.data.error.message && result.data.error.message.value) || ('SAP returned status ' + result.status);
    throw new Error('AGR_USERS read failed: ' + msg);
  }
  const raw = (result.data && result.data.d && result.data.d.ResultData) || '[]';
  let rows;
  try { rows = JSON.parse(raw); } catch (e) { rows = []; }
  return Array.isArray(rows) ? rows : [];
}

async function removeSapRole(username, roleName) {
  const csrf = await getCsrfToken();
  const payload = { Username: username, RoleName: roleName, Message: '' };
  const result = await sapPost('/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/RoleRemoveSet?sap-client=' + SAP_CONFIG.client, payload, csrf);
  if (result.status >= 400) {
    const msg = (result.data && result.data.error && result.data.error.message && result.data.error.message.value) || ('RoleRemoveSet returned status ' + result.status);
    throw new Error(msg);
  }
  const d = (result.data && result.data.d) ? result.data.d : result.data;
  return { ok: true, message: (d && d.Message) ? d.Message : 'Role removal request sent.' };
}

module.exports = { getAllAssignments, removeSapRole, SAP_CONFIG };

if (require.main === module) {
  (async () => {
    try {
      const mode = process.argv[2];
      if (mode === 'remove') {
        const user = process.argv[3], role = process.argv[4];
        if (!user || !role) { console.log('Usage: node sap-uar.js remove <USERNAME> <ROLENAME>'); return; }
        console.log('Removing role ' + role + ' from ' + user + ' ...');
        const r = await removeSapRole(user, role);
        console.log('Result:', JSON.stringify(r, null, 2));
        console.log('\nDONE. Verify with:  node sap-uar.js');
      } else {
        console.log('Reading AGR_USERS from SAP...');
        const rows = await getAllAssignments();
        console.log('Total assignments (rows):', rows.length);
        console.log('Sample (first 5):', JSON.stringify(rows.slice(0, 5), null, 2));
        console.log('\nDONE. SAP read works.');
      }
    } catch (err) { console.error('ERROR:', err.message); }
  })();
}
