const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { requireRole, attachUser, getUser, loadUsers } = require('../middleware/role-check');
const emailService = require('../email-service');

const MATRIX_FILE = path.join(__dirname, '..', 'data', 'approval-matrix.json');
const REQUESTS_FILE = path.join(__dirname, '..', 'data', 'approval-requests.json');
const USERS_FILE = path.join(__dirname, '..', 'data', 'ikaegis-users.json');

function readJSON(filepath) {
  try { return JSON.parse(fs.readFileSync(filepath, 'utf8')); }
  catch { return null; }
}
function writeJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
}
function hashPw(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}
function generateRequestId() {
  const d = new Date();
  const date = d.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `REQ-${date}-${seq}`;
}

module.exports = function(app) {

  // ════════════════════════════════════════════════════════════
  // LOGIN — file-based (replaces hardcoded USERS in server.js)
  // ════════════════════════════════════════════════════════════
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const data = readJSON(USERS_FILE);
    if (!data) return res.status(500).json({ error: 'User database unavailable' });

    const upper = username.toUpperCase();
    const user = data.users.find(u => u.username.toUpperCase() === upper && u.active !== false);

    if (!user || user.password !== hashPw(password)) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    req.session.user = {
      username: user.username,
      role: user.role,
      displayName: user.displayName
    };
    res.json({ success: true, user: req.session.user });
  });

  // ════════════════════════════════════════════════════════════
  // PROFILE
  // ════════════════════════════════════════════════════════════
  app.get('/api/my-profile', attachUser, (req, res) => {
    if (!req.ikUser) return res.status(401).json({ error: 'Not authenticated' });
    res.json(req.ikUser);
  });

  // ════════════════════════════════════════════════════════════
  // USER MANAGEMENT (admin only)
  // ════════════════════════════════════════════════════════════
  app.get('/api/ikaegis-users', requireRole('admin'), (req, res) => {
    const data = readJSON(USERS_FILE);
    if (!data) return res.status(500).json({ error: 'Failed to read users file' });
    // Strip passwords from response
    const safe = { ...data, users: data.users.map(u => ({ ...u, password: undefined })) };
    res.json(safe);
  });

  app.post('/api/ikaegis-users', requireRole('admin'), (req, res) => {
    const { username, displayName, role, password } = req.body;
    if (!username || !role || !password) {
      return res.status(400).json({ error: 'username, role, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const data = readJSON(USERS_FILE);
    if (!data) return res.status(500).json({ error: 'Failed to read users file' });

    const exists = data.users.find(u => u.username.toUpperCase() === username.toUpperCase());
    if (exists) return res.status(409).json({ error: `User ${username} already exists` });

    const validRoles = Object.keys(data.roles);
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Valid: ${validRoles.join(', ')}` });
    }

    data.users.push({
      username: username.toUpperCase(),
      displayName: displayName || username,
      role,
      active: true,
      password: hashPw(password)
    });
    writeJSON(USERS_FILE, data);
    res.json({ success: true, message: `User ${username} added with role ${role}` });
  });

  app.put('/api/ikaegis-users/:username', requireRole('admin'), (req, res) => {
    const target = req.params.username.toUpperCase();
    const { displayName, role, active } = req.body;

    const data = readJSON(USERS_FILE);
    if (!data) return res.status(500).json({ error: 'Failed to read users file' });

    const user = data.users.find(u => u.username.toUpperCase() === target);
    if (!user) return res.status(404).json({ error: `User ${target} not found` });

    if (displayName !== undefined) user.displayName = displayName;
    if (role !== undefined) {
      const validRoles = Object.keys(data.roles);
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `Invalid role. Valid: ${validRoles.join(', ')}` });
      }
      user.role = role;
    }
    if (active !== undefined) user.active = active;

    writeJSON(USERS_FILE, data);
    res.json({ success: true, user: { ...user, password: undefined } });
  });

  // Password Reset (admin only)
  app.put('/api/ikaegis-users/:username/reset-password', requireRole('admin'), (req, res) => {
    const target = req.params.username.toUpperCase();
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const data = readJSON(USERS_FILE);
    if (!data) return res.status(500).json({ error: 'Failed to read users file' });

    const user = data.users.find(u => u.username.toUpperCase() === target);
    if (!user) return res.status(404).json({ error: `User ${target} not found` });

    user.password = hashPw(newPassword);
    writeJSON(USERS_FILE, data);
    res.json({ success: true, message: `Password reset for ${target}` });
  });

  app.delete('/api/ikaegis-users/:username', requireRole('admin'), (req, res) => {
    const target = req.params.username.toUpperCase();
    const data = readJSON(USERS_FILE);
    if (!data) return res.status(500).json({ error: 'Failed to read users file' });

    const idx = data.users.findIndex(u => u.username.toUpperCase() === target);
    if (idx === -1) return res.status(404).json({ error: `User ${target} not found` });

    data.users.splice(idx, 1);
    writeJSON(USERS_FILE, data);
    res.json({ success: true, message: `User ${target} deleted` });
  });

  // ════════════════════════════════════════════════════════════
  // APPROVAL MATRIX (admin only)
  // ════════════════════════════════════════════════════════════
  app.get('/api/approval-matrix', requireRole('admin', 'manager'), (req, res) => {
    const data = readJSON(MATRIX_FILE);
    if (!data) return res.status(500).json({ error: 'Failed to read matrix file' });
    res.json(data);
  });

  app.post('/api/approval-matrix/user-manager', requireRole('admin'), (req, res) => {
    const { username, manager } = req.body;
    if (!username || !manager) return res.status(400).json({ error: 'username and manager are required' });
    const data = readJSON(MATRIX_FILE);
    if (!data) return res.status(500).json({ error: 'Failed to read matrix file' });
    data.userManagers[username.toUpperCase()] = manager.toUpperCase();
    writeJSON(MATRIX_FILE, data);
    res.json({ success: true, message: `${username} → ${manager} mapping saved` });
  });

  app.delete('/api/approval-matrix/user-manager/:username', requireRole('admin'), (req, res) => {
    const target = req.params.username.toUpperCase();
    const data = readJSON(MATRIX_FILE);
    if (!data) return res.status(500).json({ error: 'Failed to read matrix file' });
    if (!data.userManagers[target]) return res.status(404).json({ error: `No manager mapping for ${target}` });
    delete data.userManagers[target];
    writeJSON(MATRIX_FILE, data);
    res.json({ success: true, message: `Manager mapping for ${target} removed` });
  });

  app.post('/api/approval-matrix/role-owner', requireRole('admin'), (req, res) => {
    const { roleName, owner } = req.body;
    if (!roleName || !owner) return res.status(400).json({ error: 'roleName and owner are required' });
    const data = readJSON(MATRIX_FILE);
    if (!data) return res.status(500).json({ error: 'Failed to read matrix file' });
    data.roleOwners[roleName.toUpperCase()] = owner.toUpperCase();
    writeJSON(MATRIX_FILE, data);
    res.json({ success: true, message: `${roleName} → ${owner} ownership saved` });
  });

  app.delete('/api/approval-matrix/role-owner/:roleName', requireRole('admin'), (req, res) => {
    const target = req.params.roleName.toUpperCase();
    const data = readJSON(MATRIX_FILE);
    if (!data) return res.status(500).json({ error: 'Failed to read matrix file' });
    if (!data.roleOwners[target]) return res.status(404).json({ error: `No owner mapping for ${target}` });
    delete data.roleOwners[target];
    writeJSON(MATRIX_FILE, data);
    res.json({ success: true, message: `Owner mapping for ${target} removed` });
  });

  app.put('/api/approval-matrix/default-approver', requireRole('admin'), (req, res) => {
    const { approver } = req.body;
    if (!approver) return res.status(400).json({ error: 'approver is required' });
    const data = readJSON(MATRIX_FILE);
    if (!data) return res.status(500).json({ error: 'Failed to read matrix file' });
    data.defaultApprover = approver.toUpperCase();
    writeJSON(MATRIX_FILE, data);
    res.json({ success: true, message: `Default approver set to ${approver}` });
  });

  // ════════════════════════════════════════════════════════════
  // APPROVAL REQUESTS
  // ════════════════════════════════════════════════════════════
  app.post('/api/approval-requests', attachUser, (req, res) => {
    if (!req.ikUser) return res.status(401).json({ error: 'Not authenticated' });
    const b = req.body; const finalRole = (b.role || b.roleName || '').toUpperCase(); const justification = b.justification || b.reason || '';
    if (!finalRole) return res.status(400).json({ error: 'role is required' });

    const matrix = readJSON(MATRIX_FILE);
    const requests = readJSON(REQUESTS_FILE) || [];
    const username = req.ikUser.username.toUpperCase();
    const approver = (matrix.userManagers[username] || matrix.defaultApprover || 'ADMIN').toUpperCase();
    const roleOwner = matrix.roleOwners[finalRole] || null;

    const newReq = {
      id: generateRequestId(),
      requestedBy: username,
      requestedByName: req.ikUser.displayName,
      sapUsername: (b.sapUsername || req.ikUser.username).toUpperCase(),
      role: finalRole,
      approver,
      roleOwner,
      justification: justification || '',
      sodResult: null,
      status: 'pending',
      comments: '',
      requestedAt: new Date().toISOString(),
      decidedAt: null,
      decidedBy: null
    };

    requests.push(newReq);    writeJSON(REQUESTS_FILE, requests);
    emailService.notifyRequestSubmitted(newReq);
    res.json({ success: true, request: newReq, message: `Request ${newReq.id} submitted. Routed to ${approver} for approval.` });
  });

  app.get('/api/approval-requests', attachUser, (req, res) => {
    if (!req.ikUser) return res.status(401).json({ error: 'Not authenticated' });
    const requests = readJSON(REQUESTS_FILE) || [];
    const role = req.ikUser.role;
    const username = req.ikUser.username.toUpperCase();

    let filtered;
    if (role === 'admin') { filtered = requests; }
    else if (role === 'manager' || role === 'role_owner') { filtered = requests.filter(r => (r.status === 'pending' && r.approver === username) || (r.status === 'manager_approved' && r.roleOwner === username) || (r.status !== 'pending' && r.status !== 'manager_approved' && (r.approver === username || r.roleOwner === username))); }
    else { filtered = requests.filter(r => r.requestedBy === username); }

    filtered.sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (b.status === 'pending' && a.status !== 'pending') return 1;
      return new Date(b.requestedAt) - new Date(a.requestedAt);
    });

    res.json({ total: filtered.length, pending: filtered.filter(r => r.status === 'pending').length, requests: filtered });
  });

  app.put('/api/approval-requests/:id', requireRole('admin', 'manager', 'role_owner'), (req, res) => {
    const requestId = req.params.id;
    const { action, comments } = req.body;
    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action must be "approve" or "reject"' });
    }

    const requests = readJSON(REQUESTS_FILE) || [];
    const idx = requests.findIndex(r => r.id === requestId);
    if (idx === -1) return res.status(404).json({ error: `Request ${requestId} not found` });

    const request = requests[idx];
    const username = req.ikUser.username.toUpperCase();
    if (req.ikUser.role !== 'admin' && request.approver !== username && request.roleOwner !== username) {
      return res.status(403).json({ error: 'You are not the assigned approver for this request' });
    }
    if (request.status !== 'pending' && request.status !== 'manager_approved') {
      return res.status(400).json({ error: `Request already ${request.status}` });
    }

    if (action === 'reject') { request.status = 'rejected'; emailService.notifyRejection(request); } else if (request.status === 'pending' && request.roleOwner) { request.status = 'manager_approved'; request.managerDecidedBy = username; request.managerComments = comments || ''; request.managerDecidedAt = new Date().toISOString(); emailService.notifyManagerApproved(request); } else { request.status = 'approved'; emailService.notifyFinalDecision(request); if(app.assignSapRole){ var sapUser = request.sapUsername || request.requestedBy; app.assignSapRole(sapUser, request.role).then(function(result){ request.sapSyncStatus = result.success ? 'success' : 'failed'; request.sapSyncMessage = result.message || ''; requests[idx] = request; writeJSON(REQUESTS_FILE, requests); }).catch(function(err){ request.sapSyncStatus = 'failed'; request.sapSyncMessage = err.message; requests[idx] = request; writeJSON(REQUESTS_FILE, requests); }); } }
    request.comments = comments || '';
    request.decidedAt = new Date().toISOString();
    request.decidedBy = username;
    requests[idx] = request;
    writeJSON(REQUESTS_FILE, requests);
    res.json({ success: true, request, message: `Request ${requestId} has been ${request.status} by ${username}` });
  });

  app.get('/api/approval-requests/:id', attachUser, (req, res) => {
    if (!req.ikUser) return res.status(401).json({ error: 'Not authenticated' });
    const requests = readJSON(REQUESTS_FILE) || [];
    const request = requests.find(r => r.id === req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const username = req.ikUser.username.toUpperCase();
    const role = req.ikUser.role;
    if (role !== 'admin' && request.approver !== username && request.requestedBy !== username) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(request);
  });

  app.get('/api/approval-stats', attachUser, (req, res) => {
    if (!req.ikUser) return res.status(401).json({ error: 'Not authenticated' });
    const requests = readJSON(REQUESTS_FILE) || [];
    const username = req.ikUser.username.toUpperCase();
    const role = req.ikUser.role;

    let scope = requests;
    if (role === 'manager' || role === 'role_owner') { scope = requests.filter(r => (r.status === 'pending' && r.approver === username) || (r.status === 'manager_approved' && r.roleOwner === username) || (r.status !== 'pending' && r.status !== 'manager_approved' && (r.approver === username || r.roleOwner === username))); }
    else if (role !== 'admin') { scope = requests.filter(r => r.requestedBy === username); }

    res.json({
      total: scope.length,
      pending: scope.filter(r => r.status === 'pending').length,
      approved: scope.filter(r => r.status === 'approved').length,
      rejected: scope.filter(r => r.status === 'rejected').length
    });
  });

  console.log('  [IKAegis] Approval workflow routes loaded (file-based auth)');
};
