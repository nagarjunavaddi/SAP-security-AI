// db-uar.js
// IKAegis - UAR (User Access Review) module - db helper (v2)
// SEPARATE file - does NOT touch existing db.js.
// v2 adds campaign creation + line-item insert + campaign listing.
// All existing reviewer-inbox functions are unchanged.

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5
});

// ===========================================================================
// REVIEWER INBOX (unchanged from v1)
// ===========================================================================

async function getReviewerItems(reviewer) {
  const q = `
    SELECT
      li.id            AS "itemId",
      li.campaign_id   AS "campaignId",
      c.campaign_name  AS "campaignName",
      c.due_date       AS "dueDate",
      c.status         AS "campaignStatus",
      li.username      AS "username",
      li.role_name     AS "roleName",
      li.reviewer      AS "reviewer",
      li.decision      AS "decision",
      li.comment       AS "comment",
      li.reviewed_at   AS "reviewedAt",
      li.sap_sync_status  AS "sapSyncStatus",
      li.sap_sync_message AS "sapSyncMessage"
    FROM uar_line_items li
    JOIN uar_campaigns c ON c.id = li.campaign_id
    WHERE li.reviewer = $1
    ORDER BY c.due_date ASC NULLS LAST, li.username, li.role_name;
  `;
  const res = await pool.query(q, [reviewer]);
  return res.rows;
}

async function getReviewerStats(reviewer) {
  const q = `
    SELECT
      COUNT(*)                                     AS "total",
      COUNT(*) FILTER (WHERE decision = 'pending') AS "pending",
      COUNT(*) FILTER (WHERE decision = 'keep')    AS "keep",
      COUNT(*) FILTER (WHERE decision = 'revoke')  AS "revoke"
    FROM uar_line_items
    WHERE reviewer = $1;
  `;
  const res = await pool.query(q, [reviewer]);
  const r = res.rows[0] || {};
  return {
    total:   parseInt(r.total   || 0, 10),
    pending: parseInt(r.pending || 0, 10),
    keep:    parseInt(r.keep    || 0, 10),
    revoke:  parseInt(r.revoke  || 0, 10)
  };
}

// Look up one line item (used before an immediate SAP revoke to get user+role).
async function getLineItem(itemId, reviewer, isAdmin) {
  const q = `
    SELECT id AS "itemId", username AS "username", role_name AS "roleName",
           reviewer AS "reviewer", decision AS "decision"
    FROM uar_line_items
    WHERE id = $1 AND (reviewer = $2 OR ($3 AND reviewer = 'ADMIN'));
  `;
  const res = await pool.query(q, [itemId, reviewer, !!isAdmin]);
  return res.rows[0] || null;
}

// Save a decision, plus optional SAP sync status/message (for revoke removals).
async function saveDecision(itemId, reviewer, decision, comment, sapSyncStatus, sapSyncMessage, isAdmin) {
  const allowed = ['keep', 'revoke', 'pending'];
  if (!allowed.includes(decision)) {
    throw new Error('Invalid decision: ' + decision);
  }
  const q = `
    UPDATE uar_line_items
    SET decision         = $3,
        comment          = $4,
        reviewed_at      = CASE WHEN $3 = 'pending' THEN NULL ELSE NOW() END,
        reviewed_by      = CASE WHEN $3 = 'pending' THEN NULL ELSE $2 END,
        sap_sync_status  = $5,
        sap_sync_message = $6
    WHERE id = $1 AND (reviewer = $2 OR ($7 AND reviewer = 'ADMIN'))
    RETURNING
      id               AS "itemId",
      campaign_id      AS "campaignId",
      username         AS "username",
      role_name        AS "roleName",
      reviewer         AS "reviewer",
      decision         AS "decision",
      comment          AS "comment",
      reviewed_at      AS "reviewedAt",
      reviewed_by      AS "reviewedBy",
      sap_sync_status  AS "sapSyncStatus",
      sap_sync_message AS "sapSyncMessage";
  `;
  const res = await pool.query(q, [
    itemId, reviewer, decision, comment || null,
    sapSyncStatus || null, sapSyncMessage || null, !!isAdmin
  ]);
  return res.rows[0] || null;
}

// ===========================================================================
// CAMPAIGNS (v2 - admin side)
// ===========================================================================

// Create one campaign row. Returns its new id.
async function createCampaign(c) {
  const q = `
    INSERT INTO uar_campaigns
      (campaign_name, description, scope_type, scope_value, status, start_date, due_date, created_by)
    VALUES ($1, $2, $3, $4, 'active', CURRENT_DATE, $5, $6)
    RETURNING id;
  `;
  const res = await pool.query(q, [
    c.campaignName,
    c.description || null,
    c.scopeType   || null,
    c.scopeValue  || null,
    c.dueDate     || null,
    c.createdBy   || null
  ]);
  return res.rows[0].id;
}

// Bulk-insert line items in chunks (safe for tens of thousands of rows).
// items: [{ username, roleName, reviewer }]
async function insertLineItems(campaignId, items) {
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK);
    const valueSql = [];
    const params = [];
    slice.forEach((it, idx) => {
      const b = idx * 4;
      valueSql.push('($' + (b + 1) + ',$' + (b + 2) + ',$' + (b + 3) + ',$' + (b + 4) + ')');
      params.push(campaignId, it.username, it.roleName, it.reviewer);
    });
    const q = `
      INSERT INTO uar_line_items (campaign_id, username, role_name, reviewer)
      VALUES ${valueSql.join(',')};
    `;
    await pool.query(q, params);
    inserted += slice.length;
  }
  return inserted;
}

// List all campaigns with per-campaign progress counts.
async function getCampaigns() {
  const q = `
    SELECT
      c.id            AS "id",
      c.campaign_name AS "campaignName",
      c.description   AS "description",
      c.scope_type    AS "scopeType",
      c.status        AS "status",
      c.due_date      AS "dueDate",
      c.created_by    AS "createdBy",
      c.created_at    AS "createdAt",
      COUNT(li.id)                                     AS "total",
      COUNT(li.id) FILTER (WHERE li.decision='pending') AS "pending",
      COUNT(li.id) FILTER (WHERE li.decision='keep')    AS "keep",
      COUNT(li.id) FILTER (WHERE li.decision='revoke')  AS "revoke"
    FROM uar_campaigns c
    LEFT JOIN uar_line_items li ON li.campaign_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at DESC;
  `;
  const res = await pool.query(q);
  return res.rows.map(r => ({
    id: r.id,
    campaignName: r.campaignName,
    description: r.description,
    scopeType: r.scopeType,
    status: r.status,
    dueDate: r.dueDate,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    total:   parseInt(r.total   || 0, 10),
    pending: parseInt(r.pending || 0, 10),
    keep:    parseInt(r.keep    || 0, 10),
    revoke:  parseInt(r.revoke  || 0, 10)
  }));
}

// ===========================================================================
// REVIEWER DRILL-DOWN (v3 - L1 campaigns summary, L2/L3 campaign items)
// ===========================================================================

// L1: campaigns this reviewer has items in, with THIS reviewer's progress counts.
async function getReviewerCampaigns(reviewer, isAdmin) {
  const q = `
    SELECT
      c.id            AS "id",
      c.campaign_name AS "campaignName",
      c.description   AS "description",
      c.due_date      AS "dueDate",
      c.status        AS "status",
      COUNT(li.id)                                      AS "total",
      COUNT(li.id) FILTER (WHERE li.decision='pending') AS "pending",
      COUNT(li.id) FILTER (WHERE li.decision='keep')    AS "keep",
      COUNT(li.id) FILTER (WHERE li.decision='revoke')  AS "revoke"
    FROM uar_campaigns c
    JOIN uar_line_items li
      ON li.campaign_id = c.id AND (li.reviewer = $1 OR ($2 AND li.reviewer = 'ADMIN'))
    GROUP BY c.id
    ORDER BY c.due_date ASC NULLS LAST;
  `;
  const res = await pool.query(q, [reviewer, !!isAdmin]);
  return res.rows.map(r => ({
    id: r.id,
    campaignName: r.campaignName,
    description: r.description,
    dueDate: r.dueDate,
    status: r.status,
    total:   parseInt(r.total   || 0, 10),
    pending: parseInt(r.pending || 0, 10),
    keep:    parseInt(r.keep    || 0, 10),
    revoke:  parseInt(r.revoke  || 0, 10)
  }));
}

// L2/L3: all line items for this reviewer inside ONE campaign (flat list).
// Frontend regroups by user or role via the toggle - same data feeds both views.
async function getReviewerCampaignItems(reviewer, campaignId, isAdmin) {
  const q = `
    SELECT
      li.id            AS "itemId",
      li.campaign_id   AS "campaignId",
      li.username      AS "username",
      li.role_name     AS "roleName",
      li.reviewer      AS "reviewer",
      li.decision      AS "decision",
      li.comment       AS "comment",
      li.reviewed_at   AS "reviewedAt",
      li.sap_sync_status  AS "sapSyncStatus",
      li.sap_sync_message AS "sapSyncMessage"
    FROM uar_line_items li
    WHERE (li.reviewer = $1 OR ($3 AND li.reviewer = 'ADMIN')) AND li.campaign_id = $2
    ORDER BY li.username, li.role_name;
  `;
  const res = await pool.query(q, [reviewer, campaignId, !!isAdmin]);
  return res.rows;
}

// ===========================================================================
// ADMIN DRILL-DOWN (campaign-scoped, across ALL reviewers)
// ===========================================================================

// L2: per-user aggregates inside one campaign (every reviewer's items).
async function getCampaignUsers(campaignId) {
  const q = `
    SELECT
      username AS "username",
      COUNT(*)                                    AS "total",
      COUNT(*) FILTER (WHERE decision='pending')  AS "pending",
      COUNT(*) FILTER (WHERE decision='keep')     AS "keep",
      COUNT(*) FILTER (WHERE decision='revoke')   AS "revoke"
    FROM uar_line_items
    WHERE campaign_id = $1
    GROUP BY username
    ORDER BY username;
  `;
  const res = await pool.query(q, [campaignId]);
  return res.rows.map(r => ({
    username: r.username,
    total:   parseInt(r.total   || 0, 10),
    pending: parseInt(r.pending || 0, 10),
    keep:    parseInt(r.keep    || 0, 10),
    revoke:  parseInt(r.revoke  || 0, 10)
  }));
}

// L3: one user's line items inside one campaign (role + reviewer + decision).
async function getCampaignUserRoles(campaignId, username) {
  const q = `
    SELECT
      id           AS "itemId",
      role_name    AS "roleName",
      reviewer     AS "reviewer",
      decision     AS "decision",
      comment      AS "comment",
      reviewed_at  AS "reviewedAt"
    FROM uar_line_items
    WHERE campaign_id = $1 AND username = $2
    ORDER BY role_name;
  `;
  const res = await pool.query(q, [campaignId, username]);
  return res.rows;
}


// ---- Feature A: finalize + report ----
async function finalizeCampaign(id) {
  const sql = `
    UPDATE uar_campaigns
       SET status = 'completed', completed_at = NOW()
     WHERE id = $1
    RETURNING id, campaign_name, status, completed_at`;
  const { rows } = await pool.query(sql, [id]);
  const r = rows[0];
  return r ? {
    id: r.id,
    campaignName: r.campaign_name,
    status: r.status,
    completedAt: r.completed_at,
  } : null;
}

async function getCampaignReport(id) {
  const sql = `
    SELECT li.id, c.campaign_name, li.username, li.role_name, li.reviewer,
           li.decision, li.comment, li.reviewed_by, li.reviewed_at,
           li.sap_sync_status, li.sap_sync_message
      FROM uar_line_items li
      JOIN uar_campaigns c ON c.id = li.campaign_id
     WHERE li.campaign_id = $1
     ORDER BY li.username, li.role_name`;
  const { rows } = await pool.query(sql, [id]);
  return rows.map(r => ({
    id: r.id,
    campaignName: r.campaign_name,
    username: r.username,
    roleName: r.role_name,
    reviewer: r.reviewer,
    decision: r.decision,
    comment: r.comment,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    sapSyncStatus: r.sap_sync_status,
    sapSyncMessage: r.sap_sync_message,
  }));
}
// ---- end Feature A ----

module.exports = {
  finalizeCampaign,
  getCampaignReport,
  getReviewerItems,
  getReviewerStats,
  saveDecision,
  getLineItem,
  createCampaign,
  insertLineItems,
  getCampaigns,
  getReviewerCampaigns,
  getReviewerCampaignItems,
  getCampaignUsers,
  getCampaignUserRoles
};

// ---------------------------------------------------------------------------
// Standalone self-test:  node db-uar.js  [reviewerName]
// ---------------------------------------------------------------------------
if (require.main === module) {
  (async () => {
    try {
      const reviewer = process.argv[2] || 'TESTREVIEWER';
      console.log('Self-test for reviewer:', reviewer);
      const stats = await getReviewerStats(reviewer);
      console.log('Stats:', stats);
      const items = await getReviewerItems(reviewer);
      console.log('Items count:', items.length);
      const camps = await getCampaigns();
      console.log('Campaigns:', camps.length);
      console.log('\nDONE. db-uar.js queries ran successfully.');
    } catch (err) {
      console.error('ERROR:', err.message);
    } finally {
      await pool.end();
    }
  })();
}
