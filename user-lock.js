// user-lock.js  (additive - reuses sap-uar.js CSRF+POST pattern)
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

// action = 'LOCK' or 'UNLOCK'
async function setUserLock(username, action) {
  const act = String(action || 'LOCK').toUpperCase();
  if (act !== 'LOCK' && act !== 'UNLOCK') {
    throw new Error("action must be 'LOCK' or 'UNLOCK'");
  }
  const csrf = await getCsrfToken();
  const payload = { Username: username, ActionType: act, Status: '', Message: '' };
  const result = await sapPost(
    '/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/UserLockActionSet?sap-client=' + SAP_CONFIG.client,
    payload, csrf
  );
  if (result.status !== 201) {
    const msg = (result.data && result.data.error && result.data.error.message && result.data.error.message.value)
      || ('UserLockActionSet returned status ' + result.status);
    throw new Error(msg);
  }
  const d = (result.data && result.data.d) ? result.data.d : result.data;
  return {
    ok: (d && d.Status) ? (d.Status === 'SUCCESS') : true,
    status: (d && d.Status) || 'UNKNOWN',
    action: (d && d.ActionType) || act,
    username: (d && d.Username) || username,
    message: (d && d.Message) ? d.Message : 'User lock request sent.'
  };
}

module.exports = { setUserLock, SAP_CONFIG };

if (require.main === module) {
  (async () => {
    try {
      const user = process.argv[2], action = process.argv[3];
      if (!user || !action) { console.log('Usage: node user-lock.js <USERNAME> <LOCK|UNLOCK>'); return; }
      console.log(action.toUpperCase() + ' user ' + user + ' ...');
      const r = await setUserLock(user, action);
      console.log('Result:', JSON.stringify(r, null, 2));
    } catch (err) { console.error('ERROR:', err.message); }
  })();
}