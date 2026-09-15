/**
 * routes/user-lock-requests.js
 * User Lock/Unlock Approval Workflow.
 * Mirrors user-create-requests.js EXACTLY.
 *   approve -> app.setUserLock() fires
 * 100% NEW FILE. Additive.
 */

const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config();

const db = require('../db');
const { attachUser } = require('../middleware/role-check');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = function (app) {

  // POST /api/user-lock-requests  � submit
  app.post('/api/user-lock-requests', attachUser, async (req, res) => {
    try {
      if (!req.ikUser) return res.status(401).json({ error: 'Not authenticated' });

      const { username, actionType, justification, validFrom, validTo } = req.body;
      const act = String(actionType || '').toUpperCase();

      if (!username || !act) {
        return res.status(400).json({ error: 'username and actionType are required' });
      }
      if (act !== 'LOCK' && act !== 'UNLOCK') {
        return res.status(400).json({ error: "actionType must be 'LOCK' or 'UNLOCK'" });
      }
      if (!justification) {
        return res.status(400).json({ error: 'justification is required' });
      }

      const requestedBy = req.ikUser.username.toUpperCase();

      const managers        = await db.getUserManagers();
      const defaultApprover = await db.getDefaultApprover();
      const approver = (managers[username.toUpperCase()] || defaultApprover || 'ADMIN').toUpperCase();

      const id = 'ULR-' + crypto.randomBytes(4).toString('hex').toUpperCase();

      await pool.query(
        `INSERT INTO user_lock_requests
           (id, username, action_type, justification, valid_from, valid_to, requested_by, approver, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
        [id, username.toUpperCase(), act, justification,
         validFrom || null, validTo || null, requestedBy, approver]
      );

      await db.logAudit('USER_LOCK_REQUESTED', requestedBy, {
        requestId: id, targetUser: username.toUpperCase(), actionType: act, approver
      });

      res.json({
        success: true,
        request: { id, username: username.toUpperCase(), actionType: act, approver, status: 'pending' },
        message: `Request ${id} submitted. Routed to ${approver} for approval.`
      });
    } catch (err) {
      console.error('POST /api/user-lock-requests:', err.message);
      res.status(500).json({ error: 'Failed to submit request' });
    }
  });

  // GET /api/user-lock-requests  � list
  app.get('/api/user-lock-requests', attachUser, async (req, res) => {
    try {
      if (!req.ikUser) return res.status(401).json({ error: 'Not authenticated' });

      const username = req.ikUser.username.toUpperCase();
      const role     = req.ikUser.role;

      const r = await pool.query(`SELECT * FROM user_lock_requests ORDER BY created_at DESC`);
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
          id: x.id, username: x.username, actionType: x.action_type,
          justification: x.justification, validFrom: x.valid_from, validTo: x.valid_to,
          requestedBy: x.requested_by, approver: x.approver,
          status: x.status, comments: x.comments, sapResult: x.sap_result,
          createdAt: x.created_at, updatedAt: x.updated_at
        }))
      });
    } catch (err) {
      console.error('GET /api/user-lock-requests:', err.message);
      res.status(500).json({ error: 'Failed to load requests' });
    }
  });

  // GET /api/user-lock-requests/stats  � badge count (BEFORE :id)
  app.get('/api/user-lock-requests/stats', attachUser, async (req, res) => {
    try {
      if (!req.ikUser) return res.json({ pending: 0 });

      const username = req.ikUser.username.toUpperCase();
      const role     = req.ikUser.role;
      const r = await pool.query(`SELECT approver FROM user_lock_requests WHERE status='pending'`);
      const pending = role === 'admin'
        ? r.rows.length
        : r.rows.filter(x => x.approver === username).length;
      res.json({ pending });
    } catch (err) {
      res.json({ pending: 0 });
    }
  });

  // POST /api/user-lock-requests/:id/action  � approve/reject
  app.post('/api/user-lock-requests/:id/action', attachUser, async (req, res) => {
    try {
      if (!req.ikUser) return res.status(401).json({ error: 'Not authenticated' });

      const { action, comments } = req.body;
      const requestId = req.params.id;
      const username  = req.ikUser.username.toUpperCase();

      if (!action || !['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'action must be "approve" or "reject"' });
      }

      const found = await pool.query(`SELECT * FROM user_lock_requests WHERE id=$1`, [requestId]);
      const request = found.rows[0];
      if (!request) return res.status(404).json({ error: 'Request not found' });
      if (request.status !== 'pending') {
        return res.status(400).json({ error: `Request already ${request.status}` });
      }
      if (req.ikUser.role !== 'admin' && request.approver !== username) {
        return res.status(403).json({ error: 'You are not the assigned approver' });
      }

      // REJECT
      if (action === 'reject') {
        await pool.query(
          `UPDATE user_lock_requests
             SET status='rejected', comments=$1, updated_at=NOW() WHERE id=$2`,
          [comments || `Rejected by ${username}`, requestId]
        );
        await db.logAudit('USER_LOCK_REJECTED', username, {
          requestId, targetUser: request.username, actionType: request.action_type
        });
        return res.json({ success: true, message: `Request ${requestId} rejected.` });
      }

      // APPROVE -> fire SAP lock/unlock
      let sapMessage = '';
      let sapOk = false;
      try {
        if (typeof app.setUserLock !== 'function') {
          throw new Error('setUserLock not wired (check server.js patch)');
        }
        const sapResult = await app.setUserLock(request.username, request.action_type);
        sapOk = !!(sapResult && sapResult.ok);
        sapMessage = (sapResult && (sapResult.message || sapResult.Message)) || 'Action completed';
      } catch (sapErr) {
        sapMessage = 'SAP Error: ' + sapErr.message;
        sapOk = false;
      }

      await pool.query(
        `UPDATE user_lock_requests
           SET status=$1, comments=$2, sap_result=$3, updated_at=NOW() WHERE id=$4`,
        [sapOk ? 'approved' : 'sap_failed',
         comments || `Approved by ${username}`,
         sapMessage, requestId]
      );

      await db.logAudit(
        sapOk ? 'USER_LOCK_APPROVED' : 'USER_LOCK_SAP_FAILED',
        username, { requestId, targetUser: request.username, actionType: request.action_type, sapMessage }
      );

      res.json({
        success: sapOk,
        message: sapOk
          ? `User ${request.username} ${request.action_type.toLowerCase()}ed successfully in SAP.`
          : `Approved but SAP action failed: ${sapMessage}`,
        sapResult: sapMessage
      });
    } catch (err) {
      console.error('POST /api/user-lock-requests/:id/action:', err.message);
      res.status(500).json({ error: 'Failed to process action' });
    }
  });

};