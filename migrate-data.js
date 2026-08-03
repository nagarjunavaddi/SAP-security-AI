require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Starting data migration...\n');

    // 1. Migrate users
    const usersData = JSON.parse(fs.readFileSync('./data/ikaegis-users.json', 'utf8'));
    for (const u of usersData.users) {
      await client.query(
        `INSERT INTO ik_users (username, display_name, role, active, password, email)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (username) DO NOTHING`,
        [u.username, u.displayName, u.role, u.active, u.password, u.email || '']
      );
    }
    console.log('Migrated: ' + usersData.users.length + ' users');

    // 2. Migrate roles
    for (const [key, val] of Object.entries(usersData.roles)) {
      await client.query(
        `INSERT INTO ik_roles (role_key, label, permissions)
         VALUES ($1,$2,$3) ON CONFLICT (role_key) DO NOTHING`,
        [key, val.label, val.permissions]
      );
    }
    console.log('Migrated: ' + Object.keys(usersData.roles).length + ' roles');

    // 3. Migrate approval matrix
    const matrix = JSON.parse(fs.readFileSync('./data/approval-matrix.json', 'utf8'));
    for (const [user, mgr] of Object.entries(matrix.userManagers)) {
      await client.query(
        `INSERT INTO user_managers (username, manager) VALUES ($1,$2) ON CONFLICT (username) DO NOTHING`,
        [user, mgr]
      );
    }
    console.log('Migrated: ' + Object.keys(matrix.userManagers).length + ' user-manager mappings');

    for (const [role, owner] of Object.entries(matrix.roleOwners)) {
      await client.query(
        `INSERT INTO role_owners (role_name, owner) VALUES ($1,$2) ON CONFLICT (role_name) DO NOTHING`,
        [role, owner]
      );
    }
    console.log('Migrated: ' + Object.keys(matrix.roleOwners).length + ' role-owner mappings');

    // Default approver
    await client.query(
      `INSERT INTO app_config (key, value) VALUES ('defaultApprover', $1) ON CONFLICT (key) DO NOTHING`,
      [matrix.defaultApprover]
    );
    console.log('Migrated: default approver = ' + matrix.defaultApprover);

    // 4. Migrate approval requests
    const requests = JSON.parse(fs.readFileSync('./data/approval-requests.json', 'utf8'));
    for (const r of requests) {
      await client.query(
        `INSERT INTO approval_requests (id, requested_by, requested_by_name, sap_username, role, approver, role_owner, justification, sod_result, status, comments, manager_comments, manager_decided_by, manager_decided_at, decided_by, decided_at, requested_at, sap_sync_status, sap_sync_message)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT (id) DO NOTHING`,
        [r.id, r.requestedBy, r.requestedByName, r.sapUsername||r.requestedBy, r.role, r.approver, r.roleOwner, r.justification, r.sodResult?JSON.stringify(r.sodResult):null, r.status, r.comments||'', r.managerComments||'', r.managerDecidedBy||null, r.managerDecidedAt||null, r.decidedBy||null, r.decidedAt||null, r.requestedAt, r.sapSyncStatus||null, r.sapSyncMessage||null]
      );
    }
    console.log('Migrated: ' + requests.length + ' approval requests');

    // Verify counts
    const counts = await client.query(`
      SELECT 'ik_users' as tbl, count(*) as cnt FROM ik_users
      UNION ALL SELECT 'ik_roles', count(*) FROM ik_roles
      UNION ALL SELECT 'approval_requests', count(*) FROM approval_requests
      UNION ALL SELECT 'user_managers', count(*) FROM user_managers
      UNION ALL SELECT 'role_owners', count(*) FROM role_owners
      UNION ALL SELECT 'app_config', count(*) FROM app_config
    `);
    console.log('\n--- Verification ---');
    counts.rows.forEach(r => console.log(r.tbl + ': ' + r.cnt + ' rows'));
    console.log('\nMigration complete!');

  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();