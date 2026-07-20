require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');

const app = express();
app.use(express.json());
app.use(express.static('.'));

// SAP Connection Config
const SAP_CONFIG = {
  hostname: 's4hana2020.support.com',
  port: 8009,
  client: '800',
  username: 'best',
  password: 'Welcome123'
};

function getLockedUsersFromSAP() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SAP_CONFIG.hostname,
      port: SAP_CONFIG.port,
      path: `/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/UserLockSet?sap-client=${SAP_CONFIG.client}&$format=json`,
      method: 'GET',
      auth: `${SAP_CONFIG.username}:${SAP_CONFIG.password}`,
      rejectUnauthorized: false,
      headers: { 'Accept': 'application/json' }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          console.log('===RAW SAP RESPONSE===');
          
          console.log(data.substring(0, 800));
          
          console.log('===END RAW===');
          const parsed = JSON.parse(data);
          const users = parsed.d.results;
          const lockedUsers = users
            .filter(u => u.LockStatus === 'Locked')
            .map(u => ({
              user: u.Username,
              reason: 'Locked in SAP (UFLAG)',
              type: u.UserType
            }));
          resolve({ lockedUsers: lockedUsers, totalUsers: users.length });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.end();
  });
}

function getDevAccessUsersFromSAP() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SAP_CONFIG.hostname,
      port: SAP_CONFIG.port,
      path: `/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/DevAccessUserSet?sap-client=${SAP_CONFIG.client}&$format=json`,
      method: 'GET',
      auth: `${SAP_CONFIG.username}:${SAP_CONFIG.password}`,
      rejectUnauthorized: false,
      headers: { 'Accept': 'application/json' }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          console.log('===DEVACCESS RAW RESPONSE===');
          
          console.log('LENGTH:', data.length);
          
          console.log(data.substring(0, 500));
          
          console.log('...LAST 300 CHARS...');
          
          console.log(data.substring(data.length - 300));
          
          console.log('===END DEVACCESS RAW===');
          const parsed = JSON.parse(data);
          const users = parsed.d.results;
          const devAccessUsers = users.map(u => ({
            user: u.Username,
            role: u.RoleName,
            authObject: u.AuthObject,
            activity: u.Activity === '01' ? 'Create (01)' : 'Change (02)',
            risk: u.Activity === '01' ? 'high' : 'medium'
          }));
          resolve(devAccessUsers);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', (e) => reject(e));
    req.end();
  });
}

app.get('/api/sap-data', async (req, res) => {
  try {
    const lockedResult = await getLockedUsersFromSAP();
    const devAccessUsers = await getDevAccessUsersFromSAP();
    res.json({
      lockedUsers: lockedResult.lockedUsers,
      totalUsers: lockedResult.totalUsers,
      devAccessUsers: devAccessUsers
    });
  } catch (error) {
    console.log('SAP fetch error:', error.message);
    res.status(500).json({ error: 'Failed to fetch SAP data: ' + error.message });
  }
});

app.post('/api/chat', async (req, res) => {
  const { question } = req.body;

  try {
    const lockedResult = await getLockedUsersFromSAP();
    const devAccessUsers = await getDevAccessUsersFromSAP();

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{
          parts: [{
            text: `You are an SAP Security expert. Answer based on this data:
Total Users: ${lockedResult.totalUsers}
Locked Users: ${JSON.stringify(lockedResult.lockedUsers)}
Dev Access Users (S_DEVELOP with Create/Change activity): ${JSON.stringify(devAccessUsers)}
Question: ${question}`
          }]
        }]
      },
      { timeout: 30000 }
    );

    console.log('Gemini response:', JSON.stringify(response.data));
    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    res.json({ answer: text || 'No answer received' });

  } catch (error) {
    console.log('Error:', error.response?.data || error.message);
    res.status(500).json({ answer: 'Error: ' + (error.response?.data?.error?.message || error.message) });
  }
});
function getCsrfTokenAndCookie() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SAP_CONFIG.hostname,
      port: SAP_CONFIG.port,
      path: `/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/?sap-client=${SAP_CONFIG.client}`,
      method: 'GET',
      auth: `${SAP_CONFIG.username}:${SAP_CONFIG.password}`,
      rejectUnauthorized: false,
      headers: { 'X-CSRF-Token': 'Fetch' }
    };

    const req = https.request(options, (res) => {
      const token = res.headers['x-csrf-token'];
      const cookies = res.headers['set-cookie'] ? res.headers['set-cookie'].join('; ') : '';
      res.on('data', () => {});
      res.on('end', () => resolve({ token, cookies }));
    });

    req.on('error', (e) => reject(e));
    req.end();
  });
}

function createSapUser(username, lastName, password) {
  return new Promise(async (resolve, reject) => {
    try {
      const { token, cookies } = await getCsrfTokenAndCookie();

      const body = JSON.stringify({
        Username: username,
        LastName: lastName,
        Password: password
      });

      const options = {
        hostname: SAP_CONFIG.hostname,
        port: SAP_CONFIG.port,
        path: `/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/SapUserCreateSet?sap-client=${SAP_CONFIG.client}`,
        method: 'POST',
        auth: `${SAP_CONFIG.username}:${SAP_CONFIG.password}`,
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-CSRF-Token': token,
          'Cookie': cookies,
          'Content-Length': Buffer.byteLength(body)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            console.log('RAW SAP RESPONSE:', data.substring(0, 500));
            const parsed = JSON.parse(data);
            resolve(parsed.d || parsed);
          } catch (e) {
            resolve({ message: 'Raw response: ' + data });
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.write(body);
      req.end();

    } catch (e) {
      reject(e);
    }
  });
}
app.post('/api/create-user', async (req, res) => {
  const { username, lastName, password } = req.body;
  try {
    const result = await createSapUser(username, lastName, password);
    res.json(result);
  } catch (error) {
    console.log('Create user error:', error.message);
    res.status(500).json({ message: 'Error: ' + error.message });
  }
});

// Same failure-detection rule used by the single-create frontend flow,
// applied here so each row in a bulk batch gets an honest success/failed status.
function looksLikeFailureMessage(msg) {
  const lower = (msg || '').toLowerCase();
  return /must|invalid|error|fail|already exist|not allowed/.test(lower);
}

// Bulk create: reuses createSapUser() one row at a time (sequential, not parallel)
// because SAP's CSRF token/session handling breaks under concurrent requests.
app.post('/api/create-users-bulk', async (req, res) => {
  const { users } = req.body;

  if (!Array.isArray(users) || !users.length) {
    return res.status(400).json({ error: 'No users provided.' });
  }

  const results = [];

  for (const u of users) {
    const username = (u.username || '').trim();
    const lastName = (u.lastName || '').trim();
    const password = u.password || '';

    if (!username || !lastName || !password) {
      results.push({
        username: username || '(blank)',
        status: 'failed',
        message: 'Missing username, lastName, or password.'
      });
      continue;
    }

    try {
      const result = await createSapUser(username, lastName, password);
      const msg = (result && (result.Message || result.message)) || '';

      if (looksLikeFailureMessage(msg)) {
        results.push({ username, status: 'failed', message: msg || 'User creation failed.' });
      } else {
        results.push({ username, status: 'success', message: msg || 'User created successfully.' });
      }
    } catch (error) {
      results.push({ username, status: 'failed', message: 'Error: ' + error.message });
    }
  }

  res.json({ results });
});

app.listen(3000, () => console.log('Running on http://localhost:3000'));
