/**
 * setup-user-create-table.js
 * ──────────────────────────────────────────────────────────────
 * Run ONCE:  node setup-user-create-table.js
 *
 * Creates ONE new table: user_create_requests
 * CREATE TABLE IF NOT EXISTS — safe to re-run, touches nothing else.
 * Mirrors the approval_requests pattern already used by the role
 * request workflow.
 * ──────────────────────────────────────────────────────────────
 */
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setup() {
  const client = await pool.connect();
  try {
    console.log('Creating user_create_requests table...\n');

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_create_requests (
        id            TEXT PRIMARY KEY,
        username      TEXT NOT NULL,
        last_name     TEXT NOT NULL,
        password      TEXT NOT NULL,
        requested_by  TEXT NOT NULL,
        approver      TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        comments      TEXT,
        sap_result    TEXT,
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('OK - table created: user_create_requests');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_ucr_status       ON user_create_requests(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ucr_approver     ON user_create_requests(approver);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ucr_requested_by ON user_create_requests(requested_by);`);
    console.log('OK - indexes created');

    console.log('\nDONE. No existing tables were modified.');
  } catch (err) {
    console.error('Setup error:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

setup();
