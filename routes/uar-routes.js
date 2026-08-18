// routes/uar-routes.js
// IKAegis - UAR (User Access Review) module - routes (v2)
// v2: reviewer roles = admin + role_owner (manager removed), plus admin campaign endpoints.
// Reuses existing requireRole middleware, db.js (role owners), db-uar.js, sap-uar.js.
// No server.js logic touched (already mounted at /api/uar).

const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/role-check');
const uarDb = require('../db-uar');
const db = require('../db');          // existing db.js - for role owners + default approver
const sapUar = require('../sap-uar'); // SAP AGR_USERS reader

// Reviewers = admins and role owners (NO manager).
const REVIEWER_ROLES = ['admin', 'role_owner'];
// Only admins can create / manage campaigns.
const ADMIN_ONLY = ['admin'];

// ===========================================================================
// REVIEWER INBOX
// ===========================================================================

// GET /api/uar/my-items - items assigned to the logged-in reviewer + stats.
router.get('/my-items', requireRole(...REVIEWER_ROLES), async (req, res) => {
  try {
    const reviewer = req.ikUser.username;
    const [items, stats] = await Promise.all([
      uarDb.getReviewerItems(reviewer),
      uarDb.getReviewerStats(reviewer)
    ]);
    res.json({ reviewer, stats, items });
  } catch (err) {
    console.error('GET /api/uar/my-items error:', err.message);
    res.status(500).json({ error: 'Failed to load review items' });
  }
});

// GET /api/uar/my-campaigns - L1: campaigns for the logged-in reviewer + per-campaign progress.
router.get('/my-campaigns', requireRole(...REVIEWER_ROLES), async (req, res) => {
  try {
    const reviewer = req.ikUser.username;
    const isAdmin = req.ikUser.role === 'admin';
    const campaigns = await uarDb.getReviewerCampaigns(reviewer, isAdmin);
    res.json({ reviewer, campaigns });
  } catch (err) {
    console.error('GET /api/uar/my-campaigns error:', err.message);
    res.status(500).json({ error: 'Failed to load campaigns' });
  }
});

// GET /api/uar/campaign/:id/items - L2/L3: this reviewer's items inside one campaign.
// Reviewer-scoped in SQL, so a reviewer can never see another reviewer's items.
router.get('/campaign/:id/items', requireRole(...REVIEWER_ROLES), async (req, res) => {
  try {
    const reviewer = req.ikUser.username;
    const isAdmin = req.ikUser.role === 'admin';
    const campaignId = parseInt(req.params.id, 10);
    if (!campaignId) {
      return res.status(400).json({ error: 'Invalid campaign id' });
    }
    const items = await uarDb.getReviewerCampaignItems(reviewer, campaignId, isAdmin);
    res.json({ reviewer, campaignId, items });
  } catch (err) {
    console.error('GET /api/uar/campaign/:id/items error:', err.message);
    res.status(500).json({ error: 'Failed to load campaign items' });
  }
});

// POST /api/uar/decision  { itemId, decision, comment }
// KEEP  -> just records the decision.
// REVOKE-> immediately removes the role from SAP, then records the decision + sync status.
//          If the SAP removal fails, the decision is NOT saved and an error is returned,
//          so a failed removal is never silently marked as done.
router.post('/decision', requireRole(...REVIEWER_ROLES), async (req, res) => {
  try {
    const reviewer = req.ikUser.username;
    const isAdmin = req.ikUser.role === 'admin';
    const { itemId, decision, comment } = req.body || {};
    if (!itemId || !decision) {
      return res.status(400).json({ error: 'itemId and decision are required' });
    }
    if (!['keep', 'revoke', 'pending'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be keep, revoke, or pending' });
    }

    // KEEP or PENDING: no SAP action, just save.
    if (decision !== 'revoke') {
      const updated = await uarDb.saveDecision(itemId, reviewer, decision, comment, null, null, isAdmin);
      if (!updated) {
        return res.status(404).json({ error: 'Item not found or not assigned to you' });
      }
      return res.json({ ok: true, item: updated });
    }

    // REVOKE: look up the item (also enforces ownership), then remove from SAP.
    const item = await uarDb.getLineItem(itemId, reviewer, isAdmin);
    if (!item) {
      return res.status(404).json({ error: 'Item not found or not assigned to you' });
    }

    let sapResult;
    try {
      sapResult = await sapUar.removeSapRole(item.username, item.roleName);
    } catch (sapErr) {
      // SAP removal failed -> do NOT record the revoke; surface the error.
      console.error('SAP role removal failed:', sapErr.message);
      return res.status(502).json({
        error: 'SAP role removal failed: ' + sapErr.message,
        sapFailed: true
      });
    }

    // SAP removal succeeded -> record the decision with sync status.
    const updated = await uarDb.saveDecision(
      itemId, reviewer, 'revoke', comment,
      'removed', sapResult.message, isAdmin
    );
    if (!updated) {
      return res.status(404).json({ error: 'Item not found or not assigned to you' });
    }
    res.json({ ok: true, item: updated, sap: sapResult });
  } catch (err) {
    console.error('POST /api/uar/decision error:', err.message);
    res.status(500).json({ error: 'Failed to save decision' });
  }
});

// ===========================================================================
// CAMPAIGNS (admin only)
// ===========================================================================

// GET /api/uar/campaign/:id/users - L2 (admin): per-user progress inside a campaign.
router.get('/campaign/:id/users', requireRole(...ADMIN_ONLY), async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    if (!campaignId) {
      return res.status(400).json({ error: 'Invalid campaign id' });
    }
    const users = await uarDb.getCampaignUsers(campaignId);
    res.json({ campaignId, users });
  } catch (err) {
    console.error('GET /api/uar/campaign/:id/users error:', err.message);
    res.status(500).json({ error: 'Failed to load campaign users' });
  }
});

// GET /api/uar/campaign/:id/user/:username/roles - L3 (admin): one user's roles + reviewer + decision.
router.get('/campaign/:id/user/:username/roles', requireRole(...ADMIN_ONLY), async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    const username = (req.params.username || '').trim();
    if (!campaignId || !username) {
      return res.status(400).json({ error: 'Invalid campaign id or username' });
    }
    const roles = await uarDb.getCampaignUserRoles(campaignId, username);
    res.json({ campaignId, username, roles });
  } catch (err) {
    console.error('GET /api/uar/campaign/:id/user/:username/roles error:', err.message);
    res.status(500).json({ error: 'Failed to load user roles' });
  }
});

// GET /api/uar/campaigns - list all campaigns with progress.
router.get('/campaigns', requireRole(...ADMIN_ONLY), async (req, res) => {
  try {
    const campaigns = await uarDb.getCampaigns();
    res.json({ campaigns });
  } catch (err) {
    console.error('GET /api/uar/campaigns error:', err.message);
    res.status(500).json({ error: 'Failed to load campaigns' });
  }
});

// POST /api/uar/campaigns
// body: { campaignName, description, dueDate, scopeType: 'ALL'|'USERS', usernames: [] }
// Pulls user-role assignments from SAP, assigns each to a reviewer
// (role owner -> default approver -> UNASSIGNED), and creates the campaign + line items.
router.post('/campaigns', requireRole(...ADMIN_ONLY), async (req, res) => {
  try {
    const { campaignName, description, dueDate, scopeType, usernames } = req.body || {};

    if (!campaignName) {
      return res.status(400).json({ error: 'campaignName is required' });
    }
    const scope = (scopeType === 'ALL') ? 'ALL' : 'USERS';
    if (scope === 'USERS' && (!Array.isArray(usernames) || usernames.length === 0)) {
      return res.status(400).json({ error: 'Provide at least one username for a user-scoped campaign' });
    }

    // 1) Pull all user-role assignments from SAP (AGR_USERS).
    let assignments = await sapUar.getAllAssignments();

    // 2) Scope filter.
    if (scope === 'USERS') {
      const set = new Set(usernames.map(u => String(u).trim().toUpperCase()).filter(Boolean));
      assignments = assignments.filter(a => set.has(String(a.UNAME || '').toUpperCase()));
    }

    // 3) Dedupe (user, role) pairs and drop empties.
    const seen = new Set();
    const clean = [];
    assignments.forEach(a => {
      const u = String(a.UNAME || '').trim();
      const r = String(a.AGR_NAME || '').trim();
      if (!u || !r) return;
      const key = u + '||' + r;
      if (seen.has(key)) return;
      seen.add(key);
      clean.push({ username: u, roleName: r });
    });

    if (!clean.length) {
      return res.status(400).json({ error: 'No role assignments found for the selected scope.' });
    }

    // 4) Reviewer = role owner -> shared ADMIN pool (all admins) if no owner.
    const owners = await db.getRoleOwners();

    const items = clean.map(it => ({
      username: it.username,
      roleName: it.roleName,
      reviewer: (owners && owners[it.roleName]) ? owners[it.roleName] : 'ADMIN'
    }));

    // 5) Persist campaign + line items.
    const scopeValue = (scope === 'USERS') ? usernames.join(',') : 'ALL';
    const campaignId = await uarDb.createCampaign({
      campaignName,
      description: description || null,
      scopeType: scope,
      scopeValue,
      dueDate: dueDate || null,
      createdBy: req.ikUser.username
    });
    const inserted = await uarDb.insertLineItems(campaignId, items);

    const unassigned = items.filter(i => i.reviewer === 'ADMIN').length;

    res.json({ ok: true, campaignId, itemsCreated: inserted, unassigned });
  } catch (err) {
    console.error('POST /api/uar/campaigns error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// FEATURE A: CAMPAIGN FINALIZE + AUDIT REPORT (admin only)
// ===========================================================================

// POST /api/uar/campaign/:id/finalize - admin marks a campaign complete.
// Soft-block: pending items are NOT blocked here; the UI warns before calling.
router.post('/campaign/:id/finalize', requireRole(...ADMIN_ONLY), async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    if (!campaignId) return res.status(400).json({ error: 'Invalid campaign id' });
    const result = await uarDb.finalizeCampaign(campaignId);
    if (!result) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ ok: true, campaign: result });
  } catch (err) {
    console.error('POST /api/uar/campaign/:id/finalize error:', err.message);
    res.status(500).json({ error: 'Failed to finalize campaign' });
  }
});

// GET /api/uar/campaign/:id/report - admin: flat line items for audit export.
router.get('/campaign/:id/report', requireRole(...ADMIN_ONLY), async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    if (!campaignId) return res.status(400).json({ error: 'Invalid campaign id' });
    const items = await uarDb.getCampaignReport(campaignId);
    res.json({ campaignId, items });
  } catch (err) {
    console.error('GET /api/uar/campaign/:id/report error:', err.message);
    res.status(500).json({ error: 'Failed to load campaign report' });
  }
});

module.exports = router;
