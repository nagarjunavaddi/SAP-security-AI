const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, '..', 'data', 'ikaegis-users.json');

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    console.error('Failed to load ikaegis-users.json:', e.message);
    return { users: [], roles: {} };
  }
}

// Get user record by username
function getUser(username) {
  const data = loadUsers();
  const upper = (username || '').toUpperCase();
  return data.users.find(u => u.username.toUpperCase() === upper && u.active !== false);
}

// Get role permissions
function getPermissions(roleName) {
  const data = loadUsers();
  const role = data.roles[roleName];
  return role ? role.permissions : [];
}

// Middleware: require one of the listed roles
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const username = req.session && req.session.user && req.session.user.username;
    if (!username) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = getUser(username);
    if (!user) {
      // User not in ikaegis-users.json — treat as basic "user" role
      if (allowedRoles.includes('user')) {
        req.ikUser = { username, displayName: username, role: 'user' };
        return next();
      }
      return res.status(403).json({ error: 'Access denied. Your role does not permit this action.' });
    }

    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: `Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${user.role}.` });
    }

    // Attach user info to request for downstream use
    req.ikUser = {
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      permissions: getPermissions(user.role)
    };
    next();
  };
}

// Middleware: attach user info without blocking (for optional role checks)
function attachUser(req, res, next) {
  const username = req.session && req.session.user && req.session.user.username;
  if (username) {
    const user = getUser(username);
    req.ikUser = user
      ? { username: user.username, displayName: user.displayName, role: user.role, permissions: getPermissions(user.role) }
      : { username, displayName: username, role: 'user', permissions: getPermissions('user') };
  }
  next();
}

module.exports = { requireRole, attachUser, getUser, getPermissions, loadUsers };
