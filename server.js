require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const session = require('express-session');

const app = express();
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-env-file',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 hour login
}));
app.use(express.static(__dirname));

// ===================== AUTH (Phase 1) =====================
// Hardcoded demo users -- swap for a real user store / SAP-backed auth later.
// Login is now handled by routes/approval-routes.js (PostgreSQL via db.js)

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/session', (req, res) => {
  if (req.session.user) res.json({ loggedIn: true, ...req.session.user });
  else res.json({ loggedIn: false });
});

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in.' });
  next();
}

// List requests -- requester sees only their own, approver sees everything
app.get('/api/requests', requireLogin, (req, res) => {
  const list = readRequests();
  if (req.session.user.role === 'approver') return res.json(list.reverse());
  res.json(list.filter(r => r.requestedBy === req.session.user.username).reverse());
});

// Approve -- triggers SAP role assignment (see assignSapRoleInSAP below)

// Reject

// SAP Connection Config
const SAP_CONFIG = {
  hostname: 's4hana2020.support.com',
  port: 8009,
  client: '800',
  username: 'best',
  password: 'Welcome123'
};

// ===================== SoD RISK ANALYSIS (Role-Level) =====================
const SOD_RULESET_FILE = path.join(__dirname, 'data', 'sod-ruleset.json');
let SOD_RULESET = [];
try {
  SOD_RULESET = JSON.parse(fs.readFileSync(SOD_RULESET_FILE, 'utf8'));
  console.log(`Loaded SoD ruleset: ${SOD_RULESET.length} risks`);
} catch (e) {
  console.log('Could not load SoD ruleset:', e.message);
}

const PERMISSION_RULESET_FILE = path.join(__dirname, 'data', 'sod-ruleset-permissionlevel.json');
let PERMISSION_RULESET = {};
try {
  PERMISSION_RULESET = JSON.parse(fs.readFileSync(PERMISSION_RULESET_FILE, 'utf8'));
  console.log(`Loaded Permission-level ruleset: ${Object.keys(PERMISSION_RULESET).length} functions`);
} catch (e) {
  console.log('Could not load Permission-level ruleset:', e.message);
}

const CRITICAL_ACTION_RULESET_FILE = path.join(__dirname, 'data', 'critical-actions.json');
let CRITICAL_ACTION_RULESET = [];
try {
  CRITICAL_ACTION_RULESET = JSON.parse(fs.readFileSync(CRITICAL_ACTION_RULESET_FILE, 'utf8'));
  console.log(`Loaded Critical Action ruleset: ${CRITICAL_ACTION_RULESET.length} risks`);
} catch (e) {
  console.log('Could not load Critical Action ruleset:', e.message);
}

function getRoleTcodesFromSAP(roleName) {
  return new Promise((resolve, reject) => {
    const filter = encodeURIComponent(`RoleName eq '${roleName}'`);
    const options = {
      hostname: SAP_CONFIG.hostname,
      port: SAP_CONFIG.port,
      path: `/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/RoleTcodeSet?sap-client=${SAP_CONFIG.client}&$filter=${filter}&$format=json`,
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
          console.log('===ROLE TCODE RAW RESPONSE===');
          console.log(data.substring(0, 500));
          console.log('===END RAW===');
          const parsed = JSON.parse(data);
          const results = parsed.d.results;
          const tcodes = results.map(r => r.Tcode);
          resolve(tcodes);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.end();
  });
}

function getRoleAuthObjects(roleName) {
  return new Promise((resolve, reject) => {
    const filter = encodeURIComponent(`RoleName eq '${roleName}'`);
    const options = {
      hostname: SAP_CONFIG.hostname,
      port: SAP_CONFIG.port,
      path: `/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/RoleAuthObject?sap-client=${SAP_CONFIG.client}&$filter=${filter}&$format=json`,
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
          console.log('===ROLE AUTH OBJECT RAW RESPONSE===');
          console.log(data.substring(0, 500));
          console.log('===END RAW===');
          const parsed = JSON.parse(data);
          const results = parsed.d.results;
          const authObjects = results.map(r => ({
            object: r.Object,
            authField: r.AuthField,
            lowValue: r.LowValue,
            highValue: r.HighValue
          }));
          resolve(authObjects);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', (e) => reject(e));
    req.end();
  });
}

// Checks if role's actual value for a field satisfies the required values list (OR logic, '*' = wildcard)
function fieldValueMatches(requiredValues, roleValue) {
  const val = (roleValue || '').toUpperCase();
  for (const req of requiredValues) {
    if (req === '*') return true;
    if (typeof req === 'object' && req.low !== undefined) {
      if (val >= req.low.toUpperCase() && val <= req.high.toUpperCase()) return true;
    } else if (val === String(req).toUpperCase()) {
      return true;
    }
  }
  return false;
}

// Checks ONE required object (all fields must match - AND across fields, OR within each field's values)
function objectRequirementSatisfied(requiredObj, roleAuthObjects) {
  const objName = requiredObj.object.toUpperCase();
  const roleEntriesForObject = roleAuthObjects.filter(a => (a.object || '').toUpperCase() === objName);
  if (roleEntriesForObject.length === 0) return false;

  for (const fieldName of Object.keys(requiredObj.fields)) {
    const requiredValues = requiredObj.fields[fieldName];
    const roleEntriesForField = roleEntriesForObject.filter(a => (a.authField || '').toUpperCase() === fieldName.toUpperCase());
    if (roleEntriesForField.length === 0) return false;
    const matched = roleEntriesForField.some(entry => fieldValueMatches(requiredValues, entry.lowValue));
    if (!matched) return false;
  }
  return true;
}

// Checks if a Function's permission requirement is satisfied (ALL required objects - AND)
function functionPermissionSatisfied(functionId, roleAuthObjects) {
  const actionGroups = PERMISSION_RULESET[functionId];
  if (!actionGroups || actionGroups.length === 0) return false;
  return actionGroups.some(group => group.objects.every(reqObj => objectRequirementSatisfied(reqObj, roleAuthObjects)));
}
// Returns the actual matched Object/Field/Value details for a satisfied function (for UI display)
function getMatchedAuthDetails(functionId, roleAuthObjects) {
  const actionGroups = PERMISSION_RULESET[functionId];
  if (!actionGroups || actionGroups.length === 0) return [];
  const satisfiedGroup = actionGroups.find(group => group.objects.every(reqObj => objectRequirementSatisfied(reqObj, roleAuthObjects)));
  if (!satisfiedGroup) return [];

  const perObject = [];
  for (const reqObj of satisfiedGroup.objects) {
    const objName = reqObj.object.toUpperCase();
    const roleEntriesForObject = roleAuthObjects.filter(a => (a.object || '').toUpperCase() === objName);
    let actvtValue = null;
    const otherFields = [];
    for (const fieldName of Object.keys(reqObj.fields)) {
      const requiredValues = reqObj.fields[fieldName];
      const matchedEntry = roleEntriesForObject.find(a => (a.authField || '').toUpperCase() === fieldName.toUpperCase() && fieldValueMatches(requiredValues, a.lowValue));
      if (matchedEntry) {
        if (fieldName.toUpperCase() === 'ACTVT') {
          actvtValue = matchedEntry.lowValue;
        } else {
          otherFields.push({ field: fieldName, value: matchedEntry.lowValue });
        }
      }
    }
    perObject.push({ object: reqObj.object, actvt: actvtValue, otherFields });
  }

  const groupsByActvt = {};
  const noActvtList = [];
  for (const po of perObject) {
    if (po.actvt !== null) {
      if (!groupsByActvt[po.actvt]) groupsByActvt[po.actvt] = [];
      groupsByActvt[po.actvt].push(po.object);
    } else {
      noActvtList.push(po);
    }
  }

  const result = [];
  for (const actvt of Object.keys(groupsByActvt)) {
    result.push({ objects: groupsByActvt[actvt], actvt, otherFields: [] });
  }
  for (const po of noActvtList) {
    result.push({ objects: [po.object], actvt: null, otherFields: po.otherFields });
  }
  return result;
}

// Main entry point - mirrors analyzeRoleLevelSoD but for Permission Level
function checkObjectLevelSoD(roleAuthObjects) {
  const violations = [];
  for (const risk of SOD_RULESET) {
    const matchedFunctions = [];
    for (const func of risk.functions) {
      if (functionPermissionSatisfied(func.functionId, roleAuthObjects)) {
        matchedFunctions.push({
          functionId: func.functionId,
          functionDescription: func.functionDescription,
          authDetails: getMatchedAuthDetails(func.functionId, roleAuthObjects)
        });
      }
    }
    if (matchedFunctions.length >= 2) {
      violations.push({
        riskId: risk.riskId,
        riskName: risk.riskName,
        riskLevel: risk.riskLevel,
        businessProcess: risk.businessProcess,
        matchedFunctions
      });
    }
  }
  return violations;
}

function getUserRolesFromSAP(username) {
  return new Promise((resolve, reject) => {
    const filter = encodeURIComponent(`Username eq '${username}'`);
    const options = {
      hostname: SAP_CONFIG.hostname,
      port: SAP_CONFIG.port,
      path: `/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/UserRole?sap-client=${SAP_CONFIG.client}&$filter=${filter}&$format=json`,
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
          const parsed = JSON.parse(data);
          const results = parsed.d.results;
          const roles = results.map(r => r.RoleName);
          resolve(roles);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.end();
  });
}

app.get('/api/risk-analysis/user/:username', async (req, res) => {
  const username = req.params.username.trim().toUpperCase();
  try {
    const roles = await getUserRolesFromSAP(username);
    if (!roles.length) {
      return res.json({ username, roleCount: 0, roles: [], violations: [], message: 'No roles found for this user.' });
    }

    let allTcodes = [];
    let allAuthObjects = [];
    for (const role of roles) {
      const roleTcodes = await getRoleTcodesFromSAP(role);
      allTcodes = allTcodes.concat(roleTcodes);
      try {
        const roleAuthObjects = await getRoleAuthObjects(role);
        allAuthObjects = allAuthObjects.concat(roleAuthObjects);
      } catch (permErr) {
        console.log('Permission-level fetch skipped for role', role, ':', permErr.message);
      }
    }

    const actionViolations = analyzeRoleLevelSoD(allTcodes).map(v => ({ ...v, riskType: 'Action Level' }));
    const permissionViolations = checkObjectLevelSoD(allAuthObjects).map(v => ({ ...v, riskType: 'Permission Level' }));
    const violations = [...actionViolations, ...permissionViolations];
    res.json({
      username,
      roleCount: roles.length,
      roles,
      tcodeCount: allTcodes.length,
      authObjectCount: allAuthObjects.length,
      violationCount: violations.length,
      violations
    });
  } catch (error) {
    console.log('User-level risk analysis error:', error.message);
    res.status(500).json({ error: 'User-level risk analysis failed: ' + error.message });
  }
});

app.post('/api/risk-analysis/users-bulk', async (req, res) => {
  const { usernames } = req.body;
  if (!Array.isArray(usernames) || !usernames.length) {
    return res.status(400).json({ error: 'No usernames provided.' });
  }

  const results = [];
  for (const raw of usernames) {
    const username = (raw || '').trim().toUpperCase();
    if (!username) continue;
    try {
      const roles = await getUserRolesFromSAP(username);
      if (!roles.length) {
        results.push({ username, roleCount: 0, roles: [], tcodeCount: 0, violationCount: 0, violations: [], message: 'No roles found.' });
        continue;
      }
      let allTcodes = [];
      for (const role of roles) {
        const roleTcodes = await getRoleTcodesFromSAP(role);
        allTcodes = allTcodes.concat(roleTcodes);
      }
      const violations = analyzeRoleLevelSoD(allTcodes);
      results.push({ username, roleCount: roles.length, roles, tcodeCount: allTcodes.length, violationCount: violations.length, violations });
    } catch (error) {
      results.push({ username, error: error.message });
    }
  }

  res.json({ results });
});
function analyzeRoleLevelSoD(roleTcodes) {
  const tcodeSet = new Set(roleTcodes.map(t => (t || '').toUpperCase()));
  const violations = [];

  for (const risk of SOD_RULESET) {
    const matchedFunctions = [];
    for (const func of risk.functions) {
      const matchedTcodes = (func.tcodes || []).filter(tc => tcodeSet.has(tc.toUpperCase()));
      if (matchedTcodes.length > 0) {
        matchedFunctions.push({
          functionId: func.functionId,
          functionDescription: func.functionDescription,
          matchedTcodes
        });
      }
    }
    // conflict exists only if 2+ functions of the SAME risk both matched
    if (matchedFunctions.length >= 2) {
      violations.push({
        riskId: risk.riskId,
        riskName: risk.riskName,
        riskLevel: risk.riskLevel,
        businessProcess: risk.businessProcess,
        matchedFunctions
      });
    }
  }  return violations;
}

function checkCriticalActionRisks(roleTcodes) {
  const tcodeSet = new Set(roleTcodes.map(t => (t || '').toUpperCase()));
  const violations = [];

  for (const risk of CRITICAL_ACTION_RULESET) {
    const matchedFunctions = [];
    for (const func of risk.functions) {
      const matchedTcodes = (func.tcodes || []).filter(tc => tcodeSet.has(tc.toUpperCase()));
      if (matchedTcodes.length > 0) {
        matchedFunctions.push({
          functionId: func.functionId,
          functionDescription: func.functionDescription,
          matchedTcodes
        });
      }
    }
    // A single critical action is a violation
    if (matchedFunctions.length >= 1) {
      violations.push({
        riskId: risk.riskId,
        riskName: risk.riskName,
        riskLevel: risk.riskLevel,
        businessProcess: risk.businessProcess,
        matchedFunctions
      });
    }
  }
  return violations;
}

app.get('/api/risk-analysis/role/:roleName', async (req, res) => {
  const roleName = req.params.roleName.trim();
  try {
    const roleTcodes = await getRoleTcodesFromSAP(roleName);    const actionViolations = roleTcodes.length
      ? analyzeRoleLevelSoD(roleTcodes).map(v => ({ ...v, riskType: 'Action Level' }))
      : [];

    const criticalActionViolations = roleTcodes.length ? checkCriticalActionRisks(roleTcodes).map(v => ({ ...v, riskType: "Critical Action" })) : [];
    let permissionViolations = [];
    let authObjectCount = 0;
    try {
      const roleAuthObjects = await getRoleAuthObjects(roleName);
      authObjectCount = roleAuthObjects.length;
      permissionViolations = checkObjectLevelSoD(roleAuthObjects).map(v => ({ ...v, riskType: 'Permission Level' }));
    } catch (permErr) {
      console.log('Permission-level check skipped:', permErr.message);
    }    const violations = [...actionViolations, ...permissionViolations, ...criticalActionViolations];

    res.json({
      role: roleName,
      tcodeCount: roleTcodes.length,
      tcodes: roleTcodes,
      authObjectCount,
      violationCount: violations.length,
      violations
    });
  } catch (error) {
    console.log('Risk analysis error:', error.message);
    res.status(500).json({ error: 'Risk analysis failed: ' + error.message });
  }
});

app.post('/api/risk-analysis/roles-bulk', async (req, res) => {
  const { roles } = req.body;
  if (!Array.isArray(roles) || !roles.length) {
    return res.status(400).json({ error: 'No roles provided.' });
  }

  const results = [];
  for (const raw of roles) {
    const roleName = (raw || '').trim();
    if (!roleName) continue;
    try {
      const roleTcodes = await getRoleTcodesFromSAP(roleName);
      if (!roleTcodes.length) {
        results.push({ role: roleName, tcodeCount: 0, violationCount: 0, violations: [], message: 'No T-codes found.' });
        continue;
      }
      const violations = analyzeRoleLevelSoD(roleTcodes);
      results.push({ role: roleName, tcodeCount: roleTcodes.length, violationCount: violations.length, violations });
    } catch (error) {
      results.push({ role: roleName, error: error.message });
    }
  }

  res.json({ results });
});

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

function getCriticalProfileUsersFromSAP() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SAP_CONFIG.hostname,
      port: SAP_CONFIG.port,
      path: `/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/CriticalProfileUserSet?sap-client=${SAP_CONFIG.client}&$format=json`,
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
          console.log('===RAW SAP_ALL RESPONSE===');
          console.log(data.substring(0, 800));
          console.log('===END RAW===');
          const parsed = JSON.parse(data);
          const users = parsed.d.results;
          const criticalProfileUsers = users.map(u => ({
            user: u.Username,
            fullName: u.Fullname,
            profile: u.Profilename,
            profileType: u.Profiletype
          }));
          resolve({ criticalProfileUsers: criticalProfileUsers, totalCriticalUsers: criticalProfileUsers.length });
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

app.get('/api/sap-user-check/:userId', async (req, res) => { try { const userId = req.params.userId.toUpperCase(); const roles = await getUserRolesFromSAP(userId); if (roles && roles.length > 0) { res.json({ exists: true, userId: userId, roleCount: roles.length }); } else { res.json({ exists: false, userId: userId }); } } catch (err) { res.json({ exists: false, userId: req.params.userId.toUpperCase(), error: err.message }); } });
app.get('/api/sap-role-check/:roleName', async (req, res) => { try { const roleName = req.params.roleName.toUpperCase(); const tcodes = await getRoleTcodesFromSAP(roleName); if (tcodes && tcodes.length > 0) { res.json({ exists: true, roleName: roleName, tcodeCount: tcodes.length }); } else { res.json({ exists: false, roleName: roleName }); } } catch (err) { res.json({ exists: false, roleName: req.params.roleName.toUpperCase(), error: err.message }); } });
app.get('/api/sap-data', async (req, res) => {
  try {
    const lockedResult = await getLockedUsersFromSAP();
    const devAccessUsers = await getDevAccessUsersFromSAP();
    const criticalProfileResult = await getCriticalProfileUsersFromSAP();
    res.json({
      lockedUsers: lockedResult.lockedUsers,
      totalUsers: lockedResult.totalUsers,
      devAccessUsers: devAccessUsers,
      criticalProfileUsers: criticalProfileResult.criticalProfileUsers,
      totalCriticalUsers: criticalProfileResult.totalCriticalUsers
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
    const criticalProfileResult = await getCriticalProfileUsersFromSAP();
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{
          parts: [{
            text: `You are an SAP Security expert. Answer based on this data:
Total Users: ${lockedResult.totalUsers}
Locked Users: ${JSON.stringify(lockedResult.lockedUsers)}
Dev Access Users (S_DEVELOP with Create/Change activity): ${JSON.stringify(devAccessUsers)}
Critical Profile Users (SAP_ALL assigned): ${JSON.stringify(criticalProfileResult.criticalProfileUsers)}
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

// ===================== ROLE ASSIGNMENT (Phase 3 wiring) =====================
// Calls the RoleAssign OData entity (SEGW EntitySet name is "RoleAssign",
// NOT "RoleAssignSet" -- confirmed via /IWFND/GW_CLIENT metadata check),
// backed by BAPI_USER_ACTGROUPS_ASSIGN.
// IMPORTANT (from earlier scoping): BAPI_USER_ACTGROUPS_ASSIGN REPLACES a
// user's whole role list, it doesn't add to it. The ABAP method behind this
// entity must first call BAPI_USER_ACTGROUPS_READ, append the new role to the
// existing list, then call BAPI_USER_ACTGROUPS_ASSIGN with the full list --
// otherwise every other role the user has gets wiped.
function assignSapRoleInSAP(username, roleName) {
  return new Promise(async (resolve, reject) => {
    try {
      const { token, cookies } = await getCsrfTokenAndCookie();

      const body = JSON.stringify({
        Username: username,
        RoleName: roleName,
        Message: ""
      });

      const options = {
        hostname: SAP_CONFIG.hostname,
        port: SAP_CONFIG.port,
        path: `/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/RoleAssign?sap-client=${SAP_CONFIG.client}`,
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
          if (res.statusCode >= 400) {
            return reject(new Error(`RoleAssign returned ${res.statusCode} -- check SEGW entity / SU01.`));
          }
          try {
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

// TEMP DIAGNOSTIC - checks why a specific risk did/didn't match at permission level
app.get('/api/debug-permission/:roleName/:riskId', async (req, res) => {
  try {
    const roleAuthObjects = await getRoleAuthObjects(req.params.roleName);
    const risk = SOD_RULESET.find(r => r.riskId === req.params.riskId);
    if (!risk) return res.status(404).json({ error: 'Risk not found' });

    const debug = risk.functions.map(func => {
      const requiredObjects = PERMISSION_RULESET[func.functionId] || [];
      const objectStatus = requiredObjects.map(reqObj => {
        const roleHasObject = roleAuthObjects.filter(a => (a.object || '').toUpperCase() === reqObj.object.toUpperCase());
        return {
          object: reqObj.object,
          roleHasThisObject: roleHasObject.length > 0,
          roleEntriesFound: roleHasObject,
          requiredFields: reqObj.fields,
          satisfied: objectRequirementSatisfied(reqObj, roleAuthObjects)
        };
      });
      return {
        functionId: func.functionId,
        overallSatisfied: functionPermissionSatisfied(func.functionId, roleAuthObjects),
        objectStatus
      };
    });

    res.json({ role: req.params.roleName, riskId: req.params.riskId, authObjectCount: roleAuthObjects.length, debug });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// TEMP DIAGNOSTIC - summary of permission-level satisfaction across ALL functions matched at action level
app.get('/api/debug-permission-summary/:roleName', async (req, res) => {
  try {
    const roleAuthObjects = await getRoleAuthObjects(req.params.roleName);
    const roleTcodes = await getRoleTcodesFromSAP(req.params.roleName);
    const actionViolations = analyzeRoleLevelSoD(roleTcodes);

    const functionIds = new Set();
    actionViolations.forEach(v => v.matchedFunctions.forEach(f => functionIds.add(f.functionId)));

    const summary = Array.from(functionIds).map(fid => {
      const actionGroups = PERMISSION_RULESET[fid] || [];
      const bestGroup = actionGroups.find(g => g.objects.every(o => objectRequirementSatisfied(o, roleAuthObjects)))
                       || actionGroups[0] || { action: 'N/A', objects: [] };
      return {
        functionId: fid,
        requiredObjectCount: bestGroup.objects.length,
        satisfied: functionPermissionSatisfied(fid, roleAuthObjects),
        objectsMissing: bestGroup.objects.filter(o => !objectRequirementSatisfied(o, roleAuthObjects)).map(o => o.object),
        checkedAction: bestGroup.action
      };
    });

    res.json({ role: req.params.roleName, authObjectCount: roleAuthObjects.length, functionsChecked: summary.length, summary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── IKAegis Approval Workflow Routes ──
app.assignSapRole = assignSapRoleInSAP; require('./routes/approval-routes')(app);

app.listen(3000, () => console.log('Running on http://localhost:3000'));

