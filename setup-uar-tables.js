// setup-uar-tables.js
// IKAegis - UAR (User Access Review) module - STEP 1
// Creates TWO new tables only: uar_campaigns and uar_line_items
// Uses CREATE TABLE IF NOT EXISTS - does NOT touch any existing table.
// Safe to re-run: if tables already exist, they are left as-is.

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setup() {
  const client = await pool.connect();
  try {
    console.log('Connected to PostgreSQL. Creating UAR tables...');

    // 1) Review campaigns (one row per review cycle)
    await client.query(`
      CREATE TABLE IF NOT EXISTS uar_campaigns (
        id            SERIAL PRIMARY KEY,
        campaign_name TEXT NOT NULL,
        description   TEXT,
        scope_type    TEXT,
        scope_value   TEXT,
        status        TEXT DEFAULT 'draft',
        start_date    DATE,
        due_date      DATE,
        created_by    TEXT,
        created_at    TIMESTAMP DEFAULT NOW(),
        completed_at  TIMESTAMP
      );
    `);
    console.log('  [ok] uar_campaigns ready');

    // 2) Line items (one row per user-role pair to be reviewed)
    await client.query(`
      CREATE TABLE IF NOT EXISTS uar_line_items (
        id               SERIAL PRIMARY KEY,
        campaign_id      INTEGER REFERENCES uar_campaigns(id) ON DELETE CASCADE,
        username         TEXT NOT NULL,
        role_name        TEXT NOT NULL,
        reviewer         TEXT,
        decision         TEXT DEFAULT 'pending',
        comment          TEXT,
        reviewed_at      TIMESTAMP,
        sap_sync_status  TEXT,
        sap_sync_message TEXT,
        created_at       TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  [ok] uar_line_items ready');

    // Indexes for fast reviewer inbox lookups
    await client.query(`CREATE INDEX IF NOT EXISTS idx_uar_items_reviewer ON uar_line_items(reviewer);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_uar_items_campaign ON uar_line_items(campaign_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_uar_items_decision ON uar_line_items(decision);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_uar_campaigns_status ON uar_campaigns(status);`);
    console.log('  [ok] indexes ready');

    // Verify the two new tables exist
    const res = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('uar_campaigns', 'uar_line_items')
      ORDER BY table_name;
    `);
    console.log('Verified tables present:', res.rows.map(r => r.table_name).join(', '));

    console.log('\nDONE. UAR tables created. No existing tables were modified.');
  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

setup();
