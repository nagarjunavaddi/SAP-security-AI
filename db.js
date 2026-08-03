require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Test connection on startup
pool.query('SELECT NOW()').then(() => console.log('PostgreSQL connected')).catch(e => console.error('DB error:', e.message));

const db = {

  // ============ USERS ============
  async getUsers() {
    const r = await pool.query('SELECT username, display_name AS "displayName", role, active, password, email FROM ik_users ORDER BY username');
    return r.rows;
  },

  async getUserByUsername(username) {
    const r = await pool.query('SELECT username, display_name AS "displayName", role, active, password, email FROM ik_users WHERE username=$1', [username.toUpperCase()]);
    return r.rows[0] || null;
  },

  async createUser(u) {
    await pool.query(
      'INSERT INTO ik_users (username, display_name, role, active, password, email) VALUES ($1,$2,$3,$4,$5,$6)',
      [u.username.toUpperCase(), u.displayName, u.role, u.active !== false, u.password, u.email || '']
    );
  },

  async updateUser(username, fields) {
    const sets = []; const vals = []; let i = 1;
    if (fields.displayName !== undefined) { sets.push('display_name=$' + i); vals.push(fields.displayName); i++; }
    if (fields.role !== undefined) { sets.push('role=$' + i); vals.push(fields.role); i++; }
    if (fields.active !== undefined) { sets.push('active=$' + i); vals.push(fields.active); i++; }
    if (fields.password !== undefined) { sets.push('password=$' + i); vals.push(fields.password); i++; }
    if (fields.email !== undefined) { sets.push('email=$' + i); vals.push(fields.email); i++; }
    sets.push('updated_at=NOW()');
    vals.push(username.toUpperCase());
    await pool.query('UPDATE ik_users SET ' + sets.join(',') + ' WHERE username=$' + i, vals);
  },

  async deleteUser(username) {
    await pool.query('DELETE FROM ik_users WHERE username=$1', [username.toUpperCase()]);
  },

  // ============ ROLES ============
  async getRoles() {
    const r = await pool.query('SELECT role_key, label, permissions FROM ik_roles');
    const roles = {};
    r.rows.forEach(row => { roles[row.role_key] = { label: row.label, permissions: row.permissions }; });
    return roles;
  },

  // ============ APPROVAL REQUESTS ============
  async getRequests() {
    const r = await pool.query(`SELECT id, requested_by AS "requestedBy", requested_by_name AS "requestedByName",
      sap_username AS "sapUsername", role, approver, role_owner AS "roleOwner", justification,
      sod_result AS "sodResult", status, comments, manager_comments AS "managerComments",
      manager_decided_by AS "managerDecidedBy", manager_decided_at AS "managerDecidedAt",
      decided_by AS "decidedBy", decided_at AS "decidedAt", requested_at AS "requestedAt",
      sap_sync_status AS "sapSyncStatus", sap_sync_message AS "sapSyncMessage"
      FROM approval_requests ORDER BY requested_at DESC`);
    return r.rows;
  },

  async getRequestById(id) {
    const r = await pool.query(`SELECT id, requested_by AS "requestedBy", requested_by_name AS "requestedByName",
      sap_username AS "sapUsername", role, approver, role_owner AS "roleOwner", justification,
      sod_result AS "sodResult", status, comments, manager_comments AS "managerComments",
      manager_decided_by AS "managerDecidedBy", manager_decided_at AS "managerDecidedAt",
      decided_by AS "decidedBy", decided_at AS "decidedAt", requested_at AS "requestedAt",
      sap_sync_status AS "sapSyncStatus", sap_sync_message AS "sapSyncMessage"
      FROM approval_requests WHERE id=$1`, [id]);
    return r.rows[0] || null;
  },

  async createRequest(req) {
    await pool.query(
      `INSERT INTO approval_requests (id, requested_by, requested_by_name, sap_username, role, approver, role_owner, justification, sod_result, status, requested_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [req.id, req.requestedBy, req.requestedByName, req.sapUsername||req.requestedBy, req.role, req.approver, req.roleOwner, req.justification, req.sodResult?JSON.stringify(req.sodResult):null, 'pending', req.requestedAt || new Date().toISOString()]
    );
  },

  async updateRequest(id, fields) {
    const sets = []; const vals = []; let i = 1;
    for (const [key, val] of Object.entries(fields)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      sets.push(col + '=$' + i); vals.push(val); i++;
    }
    vals.push(id);
    await pool.query('UPDATE approval_requests SET ' + sets.join(',') + ' WHERE id=$' + i, vals);
  },

  // ============ APPROVAL MATRIX ============
  async getUserManagers() {
    const r = await pool.query('SELECT username, manager FROM user_managers');
    const map = {};
    r.rows.forEach(row => { map[row.username] = row.manager; });
    return map;
  },

  async setUserManager(username, manager) {
    await pool.query(
      'INSERT INTO user_managers (username, manager) VALUES ($1,$2) ON CONFLICT (username) DO UPDATE SET manager=$2',
      [username.toUpperCase(), manager.toUpperCase()]
    );
  },

  async deleteUserManager(username) {
    await pool.query('DELETE FROM user_managers WHERE username=$1', [username.toUpperCase()]);
  },

  async getRoleOwners() {
    const r = await pool.query('SELECT role_name, owner FROM role_owners');
    const map = {};
    r.rows.forEach(row => { map[row.role_name] = row.owner; });
    return map;
  },

  async setRoleOwner(roleName, owner) {
    await pool.query(
      'INSERT INTO role_owners (role_name, owner) VALUES ($1,$2) ON CONFLICT (role_name) DO UPDATE SET owner=$2',
      [roleName.toUpperCase(), owner.toUpperCase()]
    );
  },

  async deleteRoleOwner(roleName) {
    await pool.query('DELETE FROM role_owners WHERE role_name=$1', [roleName.toUpperCase()]);
  },

  async getDefaultApprover() {
    const r = await pool.query("SELECT value FROM app_config WHERE key='defaultApprover'");
    return r.rows[0] ? r.rows[0].value : 'ADMIN';
  },

  async setDefaultApprover(val) {
    await pool.query("INSERT INTO app_config (key, value) VALUES ('defaultApprover', $1) ON CONFLICT (key) DO UPDATE SET value=$1", [val]);
  },

  // ============ AUDIT LOG ============
  async logAudit(action, performedBy, details) {
    await pool.query(
      'INSERT INTO audit_log (action, performed_by, target_user, target_role, request_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
      [action, performedBy, details.targetUser||null, details.targetRole||null, details.requestId||null, JSON.stringify(details)]
    );
  },

  async getAuditLogs(filters) {
    let where = ''; const vals = []; let i = 1;
    if (filters && filters.action) { where += ' AND action=$' + i; vals.push(filters.action); i++; }
    if (filters && filters.performedBy) { where += ' AND performed_by=$' + i; vals.push(filters.performedBy); i++; }
    const r = await pool.query('SELECT * FROM audit_log WHERE 1=1' + where + ' ORDER BY created_at DESC LIMIT 500', vals);
    return r.rows;
  },

  // ============ FULL DATA (for backward compatibility) ============
  async getFullUsersData() {
    const users = await db.getUsers();
    const roles = await db.getRoles();
    return { users, roles };
  },

  async getFullMatrix() {
    const userManagers = await db.getUserManagers();
    const roleOwners = await db.getRoleOwners();
    const defaultApprover = await db.getDefaultApprover();
    return { userManagers, roleOwners, defaultApprover };
  },

  pool: pool
};

module.exports = db;