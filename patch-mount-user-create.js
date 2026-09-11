/**
 * patch-mount-user-create.js
 * ──────────────────────────────────────────────────────────────
 * Run:  node patch-mount-user-create.js
 *
 * Edits server.js with TWO minimal additions:
 *   (A) exposes createSapUser on the app object, so the new route
 *       file can call it  ->  app.createSapUser = createSapUser;
 *   (B) mounts the new route file
 *       ->  require('./routes/user-create-requests')(app);
 *
 * - Takes a timestamped backup first
 * - Idempotent: re-running detects existing lines and skips
 * - Anchors on lines already confirmed to exist in server.js
 * ──────────────────────────────────────────────────────────────
 */
const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'server.js');

function run() {
  if (!fs.existsSync(FILE)) {
    console.error('ERROR: server.js not found next to this script. Place it in the project root.');
    process.exit(1);
  }

  let src = fs.readFileSync(FILE, 'utf8');
  const original = src;

  // backup
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = FILE + '.backup-' + stamp;
  fs.writeFileSync(backup, src, 'utf8');
  console.log('Backup written:', path.basename(backup));

  let addedA = false, addedB = false;

  // ── (A) expose createSapUser on app ──
  // Anchor: existing line  app.assignSapRole = assignSapRoleInSAP; ...
  const EXPOSE_LINE = 'app.createSapUser = createSapUser;';
  if (src.includes(EXPOSE_LINE)) {
    console.log('(A) createSapUser already exposed - skipping.');
  } else {
    const anchorA = 'app.assignSapRole = assignSapRoleInSAP;';
    if (src.includes(anchorA)) {
      src = src.replace(anchorA, anchorA + ' ' + EXPOSE_LINE);
      addedA = true;
      console.log('(A) createSapUser exposed on app (after assignSapRole anchor).');
    } else {
      // fallback anchor: right after the function definition
      const anchorA2 = 'function createSapUser(username, lastName, password) {';
      if (src.includes(anchorA2)) {
        // insert the expose line just before app listens / at first app.use
        const anchorMount = "app.use('/api/su53', require('./routes/su53-routes'));";
        if (src.includes(anchorMount)) {
          src = src.replace(anchorMount, EXPOSE_LINE + '\n' + anchorMount);
          addedA = true;
          console.log('(A) createSapUser exposed on app (fallback anchor).');
        } else {
          console.warn('(A) Could not find an anchor to expose createSapUser. Manual check needed.');
        }
      } else {
        console.warn('(A) createSapUser function not found. Manual check needed.');
      }
    }
  }

  // ── (B) mount the new route ──
  const MOUNT_LINE = "require('./routes/user-create-requests')(app);";
  if (src.includes(MOUNT_LINE)) {
    console.log('(B) route already mounted - skipping.');
  } else {
    // Anchor: the existing approval-routes mount line
    const anchorB = "require('./routes/approval-routes')(app);";
    if (src.includes(anchorB)) {
      src = src.replace(anchorB, anchorB + ' ' + MOUNT_LINE);
      addedB = true;
      console.log('(B) route mounted (after approval-routes anchor).');
    } else {
      const anchorB2 = "app.use('/api/su53', require('./routes/su53-routes'));";
      if (src.includes(anchorB2)) {
        src = src.replace(anchorB2, anchorB2 + '\n' + MOUNT_LINE);
        addedB = true;
        console.log('(B) route mounted (fallback anchor).');
      } else {
        console.warn('(B) Could not find an anchor to mount the route. Manual check needed.');
      }
    }
  }

  if (src === original) {
    console.log('\nNo changes needed - server.js already patched.');
    return;
  }

  fs.writeFileSync(FILE, src, 'utf8');

  // verify
  const after = fs.readFileSync(FILE, 'utf8');
  const okA = after.includes(EXPOSE_LINE);
  const okB = after.includes(MOUNT_LINE);
  console.log('\nVerification:');
  console.log('  createSapUser exposed :', okA ? 'YES' : 'NO');
  console.log('  route mounted         :', okB ? 'YES' : 'NO');
  console.log('\nDONE. Restart the node server for changes to take effect.');
}

run();
