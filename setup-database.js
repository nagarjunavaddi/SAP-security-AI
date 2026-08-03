require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setupDatabase() {
  const client = await pool.connect();
  try {
    console.log('Connected to Supabase PostgreSQL...');

    // 1. ik_users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ik_users (
        username VARCHAR(50) PRIMARY KEY,
        display_name VARCHAR(100),
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        active BOOLEAN DEFAULT true,
        password VARCHAR(255) NOT NULL,
        email VARCHAR(255) DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Table created: ik_users');

    // 2. ik_roles table (role definitions + permissions)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ik_roles (
        role_key VARCHAR(20) PRIMARY KEY,
        label VARCHAR(100),
        permissions TEXT[] DEFAULT '{}'
      );
    `);
    console.log('Table created: ik_roles');

    // 3. approval_requests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS approval_requests (
        id VARCHAR(30) PRIMARY KEY,
        requested_by VARCHAR(50) NOT NULL,
        requested_by_name VARCHAR(100),
        sap_username VARCHAR(50),
        role VARCHAR(100) NOT NULL,
        approver VARCHAR(50),
        role_owner VARCHAR(50),
        justification TEXT,
        sod_result JSONB,
        status VARCHAR(30) DEFAULT 'pending',
        comments TEXT DEFAULT '',
        manager_comments TEXT DEFAULT '',
        manager_decided_by VARCHAR(50),
        manager_decided_at TIMESTAMP,
        decided_by VARCHAR(50),
        decided_at TIMESTAMP,
        requested_at TIMESTAMP DEFAULT NOW(),
        sap_sync_status VARCHAR(20),
        sap_sync_message TEXT
      );
    `);
    console.log('Table created: approval_requests');

    // 4. approval_matrix — user to manager mapping
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_managers (
        username VARCHAR(50) PRIMARY KEY,
        manager VARCHAR(50) NOT NULL
      );
    `);
    console.log('Table created: user_managers');

    // 5. approval_matrix — role to owner mapping
    await client.query(`
      CREATE TABLE IF NOT EXISTS role_owners (
        role_name VARCHAR(100) PRIMARY KEY,
        owner VARCHAR(50) NOT NULL
      );
    `);
    console.log('Table created: role_owners');

    // 6. default approver config
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_config (
        key VARCHAR(50) PRIMARY KEY,
        value VARCHAR(255)
      );
    `);
    console.log('Table created: app_config');

    // 7. audit_log — NEW, tracks all actions
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        action VARCHAR(50) NOT NULL,
        performed_by VARCHAR(50) NOT NULL,
        target_user VARCHAR(50),
        target_role VARCHAR(100),
        request_id VARCHAR(30),
        details JSONB,
        ip_address VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Table created: audit_log');

    // Create indexes for fast queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_requests_status ON approval_requests(status);
      CREATE INDEX IF NOT EXISTS idx_requests_requested_by ON approval_requests(requested_by);
      CREATE INDEX IF NOT EXISTS idx_requests_approver ON approval_requests(approver);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_audit_performed_by ON audit_log(performed_by);
      CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at);
    `);
    console.log('Indexes created');

    console.log('\n--- All tables created successfully! ---');

  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

setupDatabase();