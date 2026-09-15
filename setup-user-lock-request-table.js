// setup-user-lock-request-table.js  (additive - creates user_lock_requests table)
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_lock_requests (
        id            TEXT PRIMARY KEY,
        username      TEXT NOT NULL,
        action_type   TEXT NOT NULL,
        justification TEXT,
        valid_from    DATE,
        valid_to      DATE,
        requested_by  TEXT NOT NULL,
        approver      TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        comments      TEXT,
        sap_result    TEXT,
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('DONE. user_lock_requests table ready.');
  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    await pool.end();
  }
})();