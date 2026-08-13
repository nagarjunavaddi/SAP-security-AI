const crypto = require('crypto');
const { requireRole, attachUser } = require('../middleware/role-check');
const emailService = require('../email-service');
const db = require('../db');

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
  // ═══════════════════════════════════════════════════════════════
  // LOGIN
  // ═══════════════════════════════════════════════════════════════
  app.post('/api/login', async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }
      const user = await db.getUserByUsername(username.toUpperCase());
      if (!user || user.active === false || user.password !== hashPw(password)) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }
      req.session.user = {
        username: user.username,
        role: user.role,
        displayName: user.displayName
      };
      res.json({ success: true, user: req.session.user });
    } catch (err) {
      console.error('Login error:', err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // PROFILE
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/my-profile', attachUser, (req, res) => {
    if (!req.ikUser) return res.status(401).json({ error: 'Not authenticated' });
    res.json(req.ikUser);
  });

  // ═══════════════════════════════════════════════════════════════
  // USER MANAGEMENT (admin only)
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/ikaegis-users', requireRole('admin'), async (req, res) => {
    try {
      const data = await db.getFullUsersData();
      // Strip passwords from response
      const safe = { ...data, users: data.users.map(u => ({ ...u, password: undefined })) };
      res.json(safe);
    } catch (err) {
      console.error('GET /api/ikaegis-users error:', err.message);
      res.status(500).json({ error: 'Failed to read users' });
    }
  });

  app.post('/api/ikaegis-users', requireRole('admin'), async (req, res) => {
    try {
      const { username, displayName, role, password, email } = req.body;
      if (!username || !role || !password) {
        return res.status(400).json({ error: 'username, role, and password are required' });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      const existing = await db.getUserByUsername(username.toUpperCase());
      if (existing) return res.status(409).json({ error: `User ${username} already exists` });
      const roles = await db.getRoles();
      const validRoles = Object.keys(roles);
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `Invalid role. Valid: ${validRoles.join(', ')}` });
      }
      await db.createUser({
        username: username.toUpperCase(),
        displayName: displayName || username,
        role,
        active: true,
        password: hashPw(password),
        email: email || ''
      });
      await db.logAudit('USER_CREATED', req.ikUser.username, { targetUser: username.toUpperCase(), role });
      res.json({ success: true, message: `User ${username} added with role ${role}` });
    } catch (err) {
      console.error('POST /api/ikaegis-users error:', err.message);
      res.status(500).json({ error: 'Failed to create user' });
    }
  });

  app.put('/api/ikaegis-users/:username', requireRole('admin'), async (req, res) => {
    try {
      const target = req.params.username.toUpperCase();
      const { displayName, role, active } = req.body;
      const user = await db.getUserByUsername(target);
      if (!user) return res.status(404).json({ error: `User ${target} not found` });
      if (role !== undefined) {
        const roles = await db.getRoles();
        const validRoles = Object.keys(roles);
        if (!validRoles.includes(role)) {
          return res.status(400).json({ error: `Invalid role. Valid: ${validRoles.join(', ')}` });
        }
      }
      const fields = {};
      if (displayName !== undefined) fields.displayName = displayName;
      if (role !== undefined) fields.role = role;
      if (active !== undefined) fields.active = active;
      await db.updateUser(target, fields);
      await db.logAudit('USER_UPDATED', req.ikUser.username, { targetUser: target, changes: fields });
      const updated = await db.getUserByUsername(target);
      res.json({ success: true, user: { ...updated, password: undefined } });
    } catch (err) {
      console.error('PUT /api/ikaegis-users error:', err.message);
      res.status(500).json({ error: 'Failed to update user' });
    }
  });

  // Password Reset (admin only)
  app.put('/api/ikaegis-users/:username/reset-password', requireRole('admin'), async (req, res) => {
    try {
      const target = req.params.username.toUpperCase();
      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
      }
      const user = await db.getUserByUsername(target);
      if (!user) return res.status(404).json({ error: `User ${target} not found` });
      await db.updateUser(target, { password: hashPw(newPassword) });
      await db.logAudit('PASSWORD_RESET', req.ikUser.username, { targetUser: target });
      res.json({ success: true, message: `Password reset for ${target}` });
    } catch (err) {
      console.error('PUT reset-password error:', err.message);
      res.status(500).json({ error: 'Failed to reset password' });
    }
  });

  app.delete('/api/ikaegis-users/:username', requireRole('admin'), async (req, res) => {
    try {
      const target = req.params.username.toUpperCase();
      const user = await db.getUserByUsername(target);
      if (!user) return res.status(404).json({ error: `User ${target} not found` });
      await db.deleteUser(target);
      await db.logAudit('USER_DELETED', req.ikUser.username, { targetUser: target });
      res.json({ success: true, message: `User ${target} deleted` });
    } catch (err) {
      console.error('DELETE /api/ikaegis-users error:', err.message);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // APPROVAL MATRIX (admin only)
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/approval-matrix', requireRole('admin', 'manager'), async (req, res) => {
    try {
      const data = await db.getFullMatrix();
      res.json(data);
    } catch (err) {
      console.error('GET /api/approval-matrix error:', err.message);
      res.status(500).json({ error: 'Failed to read matrix' });
    }
  });

  app.post('/api/approval-matrix/user-manager', requireRole('admin'), async (req, res) => {
    try {
      const { username, manager } = req.body;
      if (!username || !manager) return res.status(400).json({ error: 'username and manager are required' });
      await db.setUserManager(username.toUpperCase(), manager.toUpperCase());
      await db.logAudit('MANAGER_MAPPING_SET', req.ikUser.username, { targetUser: username.toUpperCase(), manager: manager.toUpperCase() });
      res.json({ success: true, message: `${username} → ${manager} mapping saved` });
    } catch (err) {
      console.error('POST user-manager error:', err.message);
      res.status(500).json({ error: 'Failed to save mapping' });
    }
  });

  app.delete('/api/approval-matrix/user-manager/:username', requireRole('admin'), async (req, res) => {
    try {
      const target = req.params.username.toUpperCase();
      const managers = await db.getUserManagers();
      if (!managers[target]) return res.status(404).json({ error: `No manager mapping for ${target}` });
      await db.deleteUserManager(target);
      await db.logAudit('MANAGER_MAPPING_REMOVED', req.ikUser.username, { targetUser: target });
      res.json({ success: true, message: `Manager mapping for ${target} removed` });
    } catch (err) {
      console.error('DELETE user-manager error:', err.message);
      res.status(500).json({ error: 'Failed to remove mapping' });
    }
  });

  app.post('/api/approval-matrix/role-owner', requireRole('admin'), async (req, res) => {
    try {
      const { roleName, owner } = req.body;
      if (!roleName || !owner) return res.status(400).json({ error: 'roleName and owner are required' });
      await db.setRoleOwner(roleName.toUpperCase(), owner.toUpperCase());
      await db.logAudit('ROLE_OWNER_SET', req.ikUser.username, { targetRole: roleName.toUpperCase(), owner: owner.toUpperCase() });
      res.json({ success: true, message: `${roleName} → ${owner} ownership saved` });
    } catch (err) {
      console.error('POST role-owner error:', err.message);
      res.status(500).json({ error: 'Failed to save ownership' });
    }
  });

  app.delete('/api/approval-matrix/role-owner/:roleName', requireRole('admin'), async (req, res) => {
    try {
      const target = req.params.roleName.toUpperCase();
      const owners = await db.getRoleOwners();
      if (!owners[target]) return res.status(404).json({ error: `No owner mapping for ${target}` });
      await db.deleteRoleOwner(target);
      await db.logAudit('ROLE_OWNER_REMOVED', req.ikUser.username, { targetRole: target });
      res.json({ success: true, message: `Owner mapping for ${target} removed` });
    } catch (err) {
      console.error('DELETE role-owner error:', err.message);
      res.status(500).json({ error: 'Failed to remove ownership' });
    }
  });

  app.put('/api/approval-matrix/default-approver', requireRole('admin'), async (req, res) => {
    try {
      const { approver } = req.body;
      if (!approver) return res.status(400).json({ error: 'approver is required' });
      await db.setDefaultApprover(approver.toUpperCase());
      await db.logAudit('DEFAULT_APPROVER_SET', req.ikUser.username, { approver: approver.toUpperCase() });
      res.json({ success: true, message: `Default approver set to ${approver}` });
    } catch (err) {
      console.error('PUT default-approver error:', err.message);
      res.status(500).json({ error: 'Failed to set default approver' });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // APPROVAL REQUESTS
  // ═══════════════════════════════════════════════════════════════
  app.post('/api/approval-requests', attachUser, async (req, res) => {
    try {
      if (!req.ikUser) return res.status(401).json({ error: 'Not authenticated' });
      const b = req.body;
      const finalRole = (b.role || b.roleName || '').toUpperCase();
      const justification = b.justification || b.reason || '';
      if (!finalRole) return res.status(400).json({ error: 'role is required' });

      const managers = await db.getUserManagers();
      const roleOwners = await db.getRoleOwners();
      const defaultApprover = await db.getDefaultApprover();
      const username = req.ikUser.username.toUpperCase();
      const approver = (managers[username] || defaultApprover || 'ADMIN').toUpperCase();
      const roleOwner = roleOwners[finalRole] || null;

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
        requestedAt: new Date().toISOString()
      };

      await db.createRequest(newReq);
      await db.logAudit('REQUEST_SUBMITTED', username, { requestId: newReq.id, targetRole: finalRole });
      emailService.notifyRequestSubmitted(newReq);
      res.json({ success: true, request: newReq, message: `Request ${newReq.id} submitted. Routed to ${approver} for approval.` });
    } catch (err) {
      console.error('POST /api/approval-requests error:', err.message);
      res.status(500).json({ error: 'Failed to submit request' });
    }
  });

  app.get('/api/approval-requests', attachUser, async (req, res) => {
    try {
      if (!req.ikUser) return res.status(401).json({ error: 'Not authenticated' });
      const allRequests = await db.getRequests();
      const role = req.ikUser.role;
      const username = req.ikUser.username.toUpperCase();

      let filtered;
      if (role === 'admin') {
        filtered = allRequests;
      } else if (role === 'manager' || role === 'role_owner') {
        filtered = allRequests.filter(r =>
          (r.status === 'pending' && r.approver === username) ||
          (r.status === 'manager_approved' && r.roleOwner === username) ||
          (r.status !== 'pending' && r.status !== 'manager_approved' && (r.approver === username || r.roleOwner === username))
        );
      } else {
        filtered = allRequests.filter(r => r.requestedBy === username);
      }

      filtered.sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (b.status === 'pending' && a.status !== 'pending') return 1;
        return new Date(b.requestedAt) - new Date(a.requestedAt);
      });

      res.json({ total: filtered.length, pending: filtered.filter(r => r.status === 'pending').length, requests: filtered });
    } catch (err) {
      console.error('GET /api/approval-requests error:', err.message);
      res.status(500).json({ error: 'Failed to fetch requests' });
    }
  });

  app.put('/api/approval-requests/:id', requireRole('admin', 'manager', 'role_owner'), async (req, res) => {
    try {
      const requestId = req.params.id;
      const { action, comments } = req.body;
      if (!action || !['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'action must be "approve" or "reject"' });
      }

      const request = await db.getRequestById(requestId);
      if (!request) return res.status(404).json({ error: `Request ${requestId} not found` });

      const username = req.ikUser.username.toUpperCase();
      if (req.ikUser.role !== 'admin' && request.approver !== username && request.roleOwner !== username) {
        return res.status(403).json({ error: 'You are not the assigned approver for this request' });
      }
      if (request.status !== 'pending' && request.status !== 'manager_approved') {
        return res.status(400).json({ error: `Request already ${request.status}` });
      }

      const updates = {
        comments: comments || '',
        decidedAt: new Date().toISOString(),
        decidedBy: username
      };

      if (action === 'reject') {
        updates.status = 'rejected';
        await db.updateRequest(requestId, updates);
        await db.logAudit('REQUEST_REJECTED', username, { requestId, targetRole: request.role });
        emailService.notifyRejection({ ...request, ...updates });
      } else if (request.status === 'pending' && request.roleOwner) {
        updates.status = 'manager_approved';
        updates.managerDecidedBy = username;
        updates.managerComments = comments || '';
        updates.managerDecidedAt = new Date().toISOString();
        await db.updateRequest(requestId, updates);
        await db.logAudit('REQUEST_MANAGER_APPROVED', username, { requestId, targetRole: request.role });
        emailService.notifyManagerApproved({ ...request, ...updates });
      } else {
        updates.status = 'approved';
        await db.updateRequest(requestId, updates);
        await db.logAudit('REQUEST_APPROVED', username, { requestId, targetRole: request.role });
        emailService.notifyFinalDecision({ ...request, ...updates });
        // SAP auto role assignment
        if (app.assignSapRole) {
          const sapUser = request.sapUsername || request.requestedBy;
          try {
            const result = await app.assignSapRole(sapUser, request.role);
            await db.updateRequest(requestId, {
              sapSyncStatus: (!result || /(error|fail|invalid|not authorized|must)/i.test(String((result && (result.Message || result.message)) || ''))) ? 'failed' : 'success',
              sapSyncMessage: result.message || ''
            });
          } catch (sapErr) {
            await db.updateRequest(requestId, {
              sapSyncStatus: 'failed',
              sapSyncMessage: sapErr.message
            });
          }
        }
      }

      const updated = await db.getRequestById(requestId);
      res.json({ success: true, request: updated, message: `Request ${requestId} has been ${updated.status} by ${username}` });
    } catch (err) {
      console.error('PUT /api/approval-requests error:', err.message);
      res.status(500).json({ error: 'Failed to process request' });
    }
  });

  app.get('/api/approval-requests/:id', attachUser, async (req, res) => {
    try {
      if (!req.ikUser) return res.status(401).json({ error: 'Not authenticated' });
      const request = await db.getRequestById(req.params.id);
      if (!request) return res.status(404).json({ error: 'Request not found' });
      const username = req.ikUser.username.toUpperCase();
      const role = req.ikUser.role;
      if (role !== 'admin' && request.approver !== username && request.requestedBy !== username) {
        return res.status(403).json({ error: 'Access denied' });
      }
      res.json(request);
    } catch (err) {
      console.error('GET /api/approval-requests/:id error:', err.message);
      res.status(500).json({ error: 'Failed to fetch request' });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // APPROVAL STATS (for dashboard inbox card)
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/approval-stats', attachUser, async (req, res) => {
    try {
      if (!req.ikUser) return res.status(401).json({ pending: 0 });
      const allRequests = await db.getRequests();
      const username = req.ikUser.username.toUpperCase();
      const role = req.ikUser.role;
      let pending = 0;
      if (role === 'admin') {
        pending = allRequests.filter(r => r.status === 'pending' || r.status === 'manager_approved').length;
      } else if (role === 'manager' || role === 'role_owner') {
        pending = allRequests.filter(r =>
          (r.status === 'pending' && r.approver === username) ||
          (r.status === 'manager_approved' && r.roleOwner === username)
        ).length;
      }
      res.json({ pending });
    } catch (err) {
      console.error('GET /api/approval-stats error:', err.message);
      res.json({ pending: 0 });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // AUDIT LOGS (admin only)
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/audit-logs', requireRole('admin'), async (req, res) => {
    try {
      const filters = {};
      if (req.query.action) filters.action = req.query.action;
      if (req.query.performedBy) filters.performedBy = req.query.performedBy.toUpperCase();
      const logs = await db.getAuditLogs(filters);
      res.json({ total: logs.length, logs });
    } catch (err) {
      console.error('GET /api/audit-logs error:', err.message);
      res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
  });
};