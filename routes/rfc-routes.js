const express = require('express');
const router = express.Router();
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
      res.on('end', () => {
        resolve({
          token: res.headers['x-csrf-token'],
          cookies: res.headers['set-cookie'] || []
        });
      });
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
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

router.post('/table-read', async (req, res) => {
  try {
    const { tableName, fields, whereClause, maxRows } = req.body;
    if (!tableName) return res.status(400).json({ error: 'tableName is required' });
    const csrf = await getCsrfToken();
    const payload = {
      TableName: tableName.toUpperCase(),
      Fields: fields || '',
      WhereClause: whereClause || '',
      MaxRows: String(maxRows || 100),
      ResultData: ''
    };
    const result = await sapPost(
      '/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/GenericTableReadSet?sap-client=' + SAP_CONFIG.client,
      payload, csrf
    );
    if (result.status !== 201) {
      return res.status(500).json({ error: result.data?.error?.message?.value || 'SAP error', raw: result.data });
    }
    const resultRaw = result.data?.d?.ResultData || '[]';
    let resultData;
    try { resultData = JSON.parse(resultRaw); } catch (e) { resultData = resultRaw; }
    res.json({
      success: true,
      table: tableName,
      rowCount: Array.isArray(resultData) ? resultData.length : 0,
      data: resultData
    });
  } catch (err) {
    console.error('RFC Table Read error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/bapi-call', async (req, res) => {
  try {
    const { bapiName, inputParams } = req.body;
    if (!bapiName) return res.status(400).json({ error: 'bapiName is required' });
    let paramString = '';
    if (inputParams && typeof inputParams === 'object') {
      paramString = Object.entries(inputParams).map(([k, v]) => k + '=' + v).join(';');
    } else if (typeof inputParams === 'string') {
      paramString = inputParams;
    }
    const csrf = await getCsrfToken();
    const payload = {
      BapiName: bapiName,
      InputParams: paramString,
      OutputData: ''
    };
    const result = await sapPost(
      '/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/GenericBapiCallSet?sap-client=' + SAP_CONFIG.client,
      payload, csrf
    );
    if (result.status !== 201) {
      return res.status(500).json({ error: result.data?.error?.message?.value || 'SAP error', raw: result.data });
    }
    const outputRaw = result.data?.d?.OutputData || '{}';
    let outputData;
    try { outputData = JSON.parse(outputRaw); } catch (e) { outputData = outputRaw; }
    res.json({ success: true, bapi: bapiName, data: outputData });
  } catch (err) {
    console.error('RFC BAPI Call error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
