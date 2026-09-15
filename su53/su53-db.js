// su53/su53-db.js
// Restart-safe storage for SU53 events (Option A lifecycle: open/resolved/dismissed).
// Reuses the shared pg Pool from ../db.js (same DATABASE_URL, same style).
// 100% additive: new file, no existing DB helper touched.

const db = require('../db');
const pool = db.pool;

const su53db = {
  // Insert a freshly investigated event (status defaults to 'open').
  async insertEvent(result) {
    const ctx = result.context || {};
    const uc  = result.userContext || {};
    await pool.query(
      `INSERT INTO su53_events
         (id, sap_user, tcode, auth_object, field, value, status,
          suggestions, pending_roles, context, user_context, explanation,
          total_matched, more_batch, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9,$10,$11,$12,$13,NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        result.id,
        (ctx.user || '').toUpperCase(),
        ctx.tcode || null,
        (ctx.authObject || '').toUpperCase(),
        ctx.field || null,
        ctx.value != null ? String(ctx.value) : null,
        result.suggestions ? JSON.stringify(result.suggestions) : null,
        result.pendingRoles ? JSON.stringify(result.pendingRoles) : null,
        result.context ? JSON.stringify(result.context) : null,
        result.userContext ? JSON.stringify(result.userContext) : null,
        result.explanation || null,
        typeof result.totalMatched === 'number' ? result.totalMatched : null,
        typeof result.moreBatch === 'number' ? result.moreBatch : null,
      ]
    );
  },

  // List events by status (default: open only), newest first.
  async listEvents(status) {
    const st = status || 'open';
    const r = await pool.query(
      `SELECT id, sap_user, tcode, auth_object, field, value, status,
              suggestions, pending_roles, context, user_context, explanation,
              total_matched, more_batch, resolved_by, resolved_at, resolve_note,
              created_at
         FROM su53_events
        WHERE status = $1
        ORDER BY created_at DESC
        LIMIT 200`,
      [st]
    );
    return r.rows.map(rowToItem);
  },

  // Fetch one event (any status).
  async getEvent(id) {
    const r = await pool.query(
      `SELECT id, sap_user, tcode, auth_object, field, value, status,
              suggestions, pending_roles, context, user_context, explanation,
              total_matched, more_batch, resolved_by, resolved_at, resolve_note,
              created_at
         FROM su53_events WHERE id = $1`,
      [id]
    );
    return r.rows[0] ? rowToItem(r.rows[0]) : null;
  },

  // After "See more": persist the grown suggestions + shrunk pending list.
  async updateScoring(id, suggestions, pendingRoles) {
    await pool.query(
      `UPDATE su53_events
          SET suggestions = $2, pending_roles = $3
        WHERE id = $1`,
      [id, JSON.stringify(suggestions || []), JSON.stringify(pendingRoles || [])]
    );
  },

  // Option A lifecycle: mark resolved or dismissed.
  async setStatus(id, status, resolvedBy, note) {
    const r = await pool.query(
      `UPDATE su53_events
          SET status = $2, resolved_by = $3, resolve_note = $4, resolved_at = NOW()
        WHERE id = $1
        RETURNING id`,
      [id, status, resolvedBy || null, note || null]
    );
    return r.rowCount > 0;
  },

  // Count open events (for the dashboard SU53 tile).
  async countOpen() {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM su53_events WHERE status='open'`);
    return r.rows[0] ? r.rows[0].n : 0;
  },
};

// DB row -> the item shape su53-inbox.html already expects.
function rowToItem(row) {
  return {
    id: row.id,
    status: row.status,
    context: row.context || {
      user: row.sap_user, tcode: row.tcode, authObject: row.auth_object,
      field: row.field, value: row.value,
    },
    userContext: row.user_context || null,
    suggestions: row.suggestions || [],
    pendingRoles: row.pending_roles || [],
    explanation: row.explanation || '',
    totalMatched: row.total_matched != null ? row.total_matched : (row.suggestions ? row.suggestions.length : 0),
    moreBatch: row.more_batch != null ? row.more_batch : 20,
    resolvedBy: row.resolved_by || null,
    resolvedAt: row.resolved_at || null,
    resolveNote: row.resolve_note || null,
    generatedAt: row.created_at,
  };
}

module.exports = su53db;
