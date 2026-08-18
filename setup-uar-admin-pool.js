// setup-uar-admin-pool.js
// IKAegis UAR - admin-pool step B1 (DB, non-destructive, idempotent):
//   1) add reviewed_by column (records the actual admin who decided a pooled item)
//   2) migrate existing reviewer='UNASSIGNED' rows to the shared 'ADMIN' pool
// Usage:  node setup-uar-admin-pool.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2
});

(async () => {
  try {
    await pool.query("ALTER TABLE uar_line_items ADD COLUMN IF NOT EXISTS reviewed_by text");
    console.log("OK: reviewed_by column ensured on uar_line_items");

    const r = await pool.query("UPDATE uar_line_items SET reviewer='ADMIN' WHERE reviewer='UNASSIGNED'");
    console.log("OK: migrated " + r.rowCount + " 'UNASSIGNED' row(s) to the 'ADMIN' pool");
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
