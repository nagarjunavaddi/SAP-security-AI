const db = require('../db');

// Get user record by username (async)
async function getUser(username) {
  const user = await db.getUserByUsername((username || '').toUpperCase());
  if (!user || user.active === false) return null;
  return user;
}

// Get role permissions (async)
async function getPermissions(roleName) {
  const roles = await db.getRoles();
  const role = roles[roleName];
  return role ? role.permissions : [];
}

// Middleware: require one of the listed roles
function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    try {
      const username = req.session && req.session.user && req.session.user.username;
      if (!username) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const user = await getUser(username);
      if (!user) {
        // User not in database — treat as basic "user" role
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
        permissions: await getPermissions(user.role)
      };
      next();
    } catch (err) {
      console.error('requireRole middleware error:', err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

// Middleware: attach user info without blocking (for optional role checks)
async function attachUser(req, res, next) {
  try {
    const username = req.session && req.session.user && req.session.user.username;
    if (username) {
      const user = await getUser(username);
      req.ikUser = user
        ? { username: user.username, displayName: user.displayName, role: user.role, permissions: await getPermissions(user.role) }
        : { username, displayName: username, role: 'user', permissions: await getPermissions('user') };
    }
    next();
  } catch (err) {
    console.error('attachUser middleware error:', err.message);
    next();
  }
}

module.exports = { requireRole, attachUser, getUser, getPermissions };
