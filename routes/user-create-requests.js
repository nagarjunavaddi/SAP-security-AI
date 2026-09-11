/**
 * routes/user-create-requests.js
 * ──────────────────────────────────────────────────────────────
 * User Creation Approval Workflow.
 *
 * Mirrors the existing role-request approval flow in
 * approval-routes.js EXACTLY:
 *   - uses the shared attachUser middleware from ../middleware/role-check
 *     (it sets req.ikUser)
 *   - routes to manager via db.getUserManagers() + db.getDefaultApprover()
 *
 * Flow:
 *   1. Requester submits POST /api/user-create-requests
 *   2. Routed to requester's manager
 *   3. Manager approves -> app.createSapUser() fires
 *   4. Manager rejects  -> request closed, no SAP user created
 *
 * 100% NEW FILE. Additive. Nothing existing is edited by this file.
 * ──────────────────────────────────────────────────────────────
 */

const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config();

const db = require('../db');                                   // getUserManagers, getDefaultApprover, logAudit
const { attachUser } = require('../middleware/role-check');    // sets req.ikUser (same as approval-routes)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = function (app) {

  // ════════════════════════════════════════════════════════════
  //  POST /api/user-create-requests   — submit new request
  // ════════════════════════════════════════════════════════════
  app.post('/api/user-create-requests', attachUser, async (req, res) => {
    try {
      if (!req.ikUser) return res.status(401).json({ error: 'Not authenticated' });

      const { username, lastName, password } = req.body;
      if (!username || !lastName || !password) {
        return res.status(400).json({ error: 'username, lastName and password are required' });
      }

      const requestedBy = req.ikUser.username.toUpperCase();

      // route to manager exactly like the role-request flow
      const managers        = await db.getUserManagers();
      const defaultApprover = await db.getDefaultApprover();
      const approver = (managers[requestedBy] || defaultApprover || 'ADMIN').toUpperCase();

      const id = 'UCR-' + crypto.randomBytes(4).toString('hex').toUpperCase();

      await pool.query(
        `INSERT INTO user_create_requests
           (id, username, last_name, password, requested_by, approver, status)
         VALUES ($1,$2,$3,$4,$5,$6,'pending')`,
        [id, username.toUpperCase(), lastName, password, requestedBy, approver]
      );

      await db.logAudit('USER_CREATE_REQUESTED', requestedBy, {
        requestId: id, targetUser: username.toUpperCase(), approver
      });

      res.json({
        success: true,
        request: { id, username: username.toUpperCase(), approver, status: 'pending' },
        message: `Request ${id} submitted. Routed to ${approver} for approval.`
      });
    } catch (err) {
      console.error('POST /api/user-create-requests:', err.message);
      res.status(500).json({ error: 'Failed to submit request' });
    }
  });

  // ════════════════════════════════════════════════════════════
  //  GET /api/user-create-requests   — list
  //    admin  -> all ; others -> own submissions + own approvals
  // ════════════════════════════════════════════════════════════
  app.get('/api/user-create-requests', attachUser, async (req, res) => {
    try {
      if (!req.ikUser) return res.status(401).json({ error: 'Not authenticated' });

      const username = req.ikUser.username.toUpperCase();
      const role     = req.ikUser.role;

      const r = await pool.query(`SELECT * FROM user_create_requests ORDER BY created_at DESC`);
      let rows = r.rows;

      if (role !== 'admin') {
        rows = rows.filter(x => x.requested_by === username || x.approver === username);
      }

      rows.sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (b.status === 'pending' && a.status !== 'pending') return 1;
        return new Date(b.created_at) - new Date(a.created_at);
      });

      res.json({
        total: rows.length,
        pending: rows.filter(x => x.status === 'pending').length,
        requests: rows.map(x => ({
          id: x.id, username: x.username, lastName: x.last_name,
          requestedBy: x.requested_by, approver: x.approver,
          status: x.status, comments: x.comments, sapResult: x.sap_result,
          createdAt: x.created_at, updatedAt: x.updated_at
        }))
      });
    } catch (err) {
      console.error('GET /api/user-create-requests:', err.message);
      res.status(500).json({ error: 'Failed to load requests' });
    }
  });

  // ════════════════════════════════════════════════════════════
  //  GET /api/user-create-requests/stats  — pending badge count
  //  (defined BEFORE :id route so "stats" isn't captured as an id)
  // ════════════════════════════════════════════════════════════
  app.get('/api/user-create-requests/stats', attachUser, async (req, res) => {
    try {
      if (!req.ikUser) return res.json({ pending: 0 });

      const username = req.ikUser.username.toUpperCase();
      const role     = req.ikUser.role;
      const r = await pool.query(`SELECT approver FROM user_create_requests WHERE status='pending'`);
      const pending = role === 'admin'
        ? r.rows.length
        : r.rows.filter(x => x.approver === username).length;
      res.json({ pending });
    } catch (err) {
      res.json({ pending: 0 });
    }
  });

  // ════════════════════════════════════════════════════════════
  //  POST /api/user-create-requests/:id/action
  //    body { action: "approve"|"reject", comments }
  //    approve -> app.createSapUser() fires
  // ════════════════════════════════════════════════════════════
  app.post('/api/user-create-requests/:id/action', attachUser, async (req, res) => {
    try {
      if (!req.ikUser) return res.status(401).json({ error: 'Not authenticated' });

      const { action, comments } = req.body;
      const requestId = req.params.id;
      const username  = req.ikUser.username.toUpperCase();

      if (!action || !['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'action must be "approve" or "reject"' });
      }

      const found = await pool.query(`SELECT * FROM user_create_requests WHERE id=$1`, [requestId]);
      const request = found.rows[0];
      if (!request) return res.status(404).json({ error: 'Request not found' });
      if (request.status !== 'pending') {
        return res.status(400).json({ error: `Request already ${request.status}` });
      }
      if (req.ikUser.role !== 'admin' && request.approver !== username) {
        return res.status(403).json({ error: 'You are not the assigned approver' });
      }

      // ── REJECT ──
      if (action === 'reject') {
        await pool.query(
          `UPDATE user_create_requests
             SET status='rejected', comments=$1, updated_at=NOW() WHERE id=$2`,
          [comments || `Rejected by ${username}`, requestId]
        );
        await db.logAudit('USER_CREATE_REJECTED', username, {
          requestId, targetUser: request.username
        });
        return res.json({ success: true, message: `Request ${requestId} rejected.` });
      }

      // ── APPROVE -> create in SAP ──
      let sapMessage = '';
      try {
        if (typeof app.createSapUser !== 'function') {
          throw new Error('createSapUser not wired (check server.js patch)');
        }
        const sapResult = await app.createSapUser(
          request.username, request.last_name, request.password
        );
        sapMessage = (sapResult && (sapResult.Message || sapResult.message)) || 'User created';
      } catch (sapErr) {
        sapMessage = 'SAP Error: ' + sapErr.message;
      }

      const failed = /must|invalid|error|fail|already exist|not allowed/i.test(sapMessage);

      await pool.query(
        `UPDATE user_create_requests
           SET status=$1, comments=$2, sap_result=$3, updated_at=NOW() WHERE id=$4`,
        [failed ? 'sap_failed' : 'approved',
         comments || `Approved by ${username}`,
         sapMessage, requestId]
      );

      await db.logAudit(
        failed ? 'USER_CREATE_SAP_FAILED' : 'USER_CREATE_APPROVED',
        username, { requestId, targetUser: request.username, sapMessage }
      );

      res.json({
        success: !failed,
        message: failed
          ? `Approved but SAP creation failed: ${sapMessage}`
          : `User ${request.username} created successfully in SAP.`,
        sapResult: sapMessage
      });
    } catch (err) {
      console.error('POST /api/user-create-requests/:id/action:', err.message);
      res.status(500).json({ error: 'Failed to process action' });
    }
  });

};
