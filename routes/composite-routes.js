/**
 * routes/composite-routes.js
 * ---------------------------------------------------------------------------
 * Composite role endpoints + the smart assignment wrapper.
 *
 * Endpoints (all NEW - the old /api/sap-role-check is untouched):
 *   GET /api/sap-role-check-v2/:roleName
 *       -> { exists, isComposite, childRoles, tcodeCount }
 *          Drop-in replacement for /api/sap-role-check: still returns
 *          `exists`, so existing frontend checks keep working, but now says
 *          true for composite roles too.
 *   GET /api/sap-role-children/:roleName
 *       -> { roleName, isComposite, childRoles }
 *
 * Also defines app.assignSapRoleSmart(username, roleName):
 *   composite -> assigns every child single role, one by one
 *   single    -> calls the existing app.assignSapRole unchanged
 *
 * MOUNT ORDER MATTERS: this must be required AFTER
 * `app.assignSapRole = assignSapRoleInSAP;` in server.js, because the wrapper
 * delegates to it.
 *
 * 100% NEW FILE. Nothing existing is edited by this file.
 * ---------------------------------------------------------------------------
 */

const composite = require('../sap-composite');

module.exports = function (app) {

  // ═══════════════════════════════════════════════════════════════════
  //  GET /api/sap-role-check-v2/:roleName
  // ═══════════════════════════════════════════════════════════════════
  app.get('/api/sap-role-check-v2/:roleName', async (req, res) => {
    const roleName = String(req.params.roleName || '').toUpperCase();
    try {
      const info = await composite.describeRole(roleName);

      if (info.exists) {
        return res.json({
          exists: true,
          roleName: info.roleName,
          isComposite: info.isComposite,
          childRoles: info.childRoles,
          childCount: info.childRoles.length
        });
      }

      /* AGR_DEFINE said no. Fall back to the original tcode lookup so this
         endpoint is never stricter than the one it replaces. */
      if (typeof app.getRoleTcodes === 'function') {
        try {
          const tcodes = await app.getRoleTcodes(roleName);
          if (tcodes && tcodes.length > 0) {
            return res.json({
              exists: true, roleName: roleName, isComposite: false,
              childRoles: [], tcodeCount: tcodes.length
            });
          }
        } catch (e) { /* fall through to not-found */ }
      }

      res.json({ exists: false, roleName: roleName, isComposite: false, childRoles: [] });
    } catch (err) {
      console.error('GET /api/sap-role-check-v2 error:', err.message);
      res.json({ exists: false, roleName: roleName, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  GET /api/sap-role-children/:roleName
  // ═══════════════════════════════════════════════════════════════════
  app.get('/api/sap-role-children/:roleName', async (req, res) => {
    const roleName = String(req.params.roleName || '').toUpperCase();
    try {
      const children = await composite.getChildRoles(roleName);
      res.json({
        roleName: roleName,
        isComposite: children.length > 0,
        childRoles: children,
        childCount: children.length
      });
    } catch (err) {
      console.error('GET /api/sap-role-children error:', err.message);
      res.status(500).json({ error: err.message, roleName: roleName, childRoles: [] });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  app.assignSapRoleSmart(username, roleName)
  //  Composite -> assign each child single role. Single -> unchanged path.
  // ═══════════════════════════════════════════════════════════════════
  app.assignSapRoleSmart = async function (username, roleName) {
    if (typeof app.assignSapRole !== 'function') {
      throw new Error('assignSapRole not wired - check server.js');
    }

    let children = [];
    try {
      children = await composite.getChildRoles(roleName);
    } catch (e) {
      console.warn('Composite lookup failed for ' + roleName + ': ' + e.message);
    }

    /* Not composite - behave exactly as before. */
    if (!children.length) {
      return app.assignSapRole(username, roleName);
    }

    console.log('Composite ' + roleName + ' -> assigning ' + children.length +
      ' child role(s): ' + children.join(', '));

    const results = [];
    const failed = [];

    for (const child of children) {
      try {
        const r = await app.assignSapRole(username, child);
        const msg = (r && (r.Message || r.message)) || 'assigned';
        results.push(child + ': ' + msg);
        if (/(error|fail|invalid|not authorized|must)/i.test(msg)) failed.push(child);
      } catch (e) {
        results.push(child + ': ERROR ' + e.message);
        failed.push(child);
      }
    }

    const ok = children.length - failed.length;
    return {
      composite: true,
      roleName: roleName,
      childRoles: children,
      assigned: ok,
      failedRoles: failed,
      message: failed.length
        ? ('Composite ' + roleName + ': ' + ok + ' of ' + children.length +
           ' roles assigned. Failed: ' + failed.join(', '))
        : ('Composite ' + roleName + ': all ' + children.length +
           ' child roles assigned to ' + username + '.'),
      detail: results
    };
  };

  console.log('Composite role support mounted (sap-role-check-v2, assignSapRoleSmart)');
};
