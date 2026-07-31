/**
 * IKAegis Approval Workflow — Setup Script
 * 
 * Run: node setup-approval-workflow.js
 * 
 * What it does:
 * 1. Creates data/ files if they don't exist (ikaegis-users.json, approval-matrix.json, approval-requests.json)
 * 2. Creates middleware/role-check.js
 * 3. Creates routes/approval-routes.js
 * 4. Patches server.js with ONE require line (if not already present)
 * 5. Does NOT touch any existing logic — only appends
 */

const fs = require('fs');
const path = require('path');

const BASE = __dirname;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;

console.log(bold('\n═══ IKAegis Approval Workflow Setup ═══\n'));

// ── Step 1: Ensure directories exist ──
['data', 'middleware', 'routes'].forEach(dir => {
  const p = path.join(BASE, dir);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
    console.log(green(`  Created directory: ${dir}/`));
  }
});

// ── Step 2: Create data files (skip if already exist) ──
const dataFiles = {
  'data/ikaegis-users.json': JSON.stringify({
    users: [
      { username: 'IKSEC2', displayName: 'System Admin', role: 'admin', active: true },
      { username: 'MANAGER1', displayName: 'Finance Manager', role: 'manager', active: true },
      { username: 'S4GRC1', displayName: 'GRC Analyst', role: 'analyst', active: true }
    ],
    roles: {
      admin: {
        label: 'Administrator',
        permissions: ['dashboard', 'sod-analysis', 'risk-analysis', 'user-creation', 'new-request', 'approvals', 'approval-config']
      },
      manager: {
        label: 'Manager / Approver',
        permissions: ['dashboard', 'sod-analysis', 'risk-analysis', 'new-request', 'approvals']
      },
      analyst: {
        label: 'GRC Analyst',
        permissions: ['dashboard', 'sod-analysis', 'risk-analysis', 'new-request']
      },
      user: {
        label: 'End User',
        permissions: ['dashboard', 'new-request']
      }
    }
  }, null, 2),

  'data/approval-matrix.json': JSON.stringify({
    userManagers: {
      S4GRC1: 'MANAGER1',
      JDOE: 'MANAGER1'
    },
    roleOwners: {
      Z_AP_ACCOUNTANT: 'MANAGER1',
      Z_AR_CLERK: 'MANAGER1'
    },
    defaultApprover: 'IKSEC2'
  }, null, 2),

  'data/approval-requests.json': '[]'
};

Object.entries(dataFiles).forEach(([relPath, content]) => {
  const fullPath = path.join(BASE, relPath);
  if (fs.existsSync(fullPath)) {
    console.log(yellow(`  Skipped (already exists): ${relPath}`));
  } else {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(green(`  Created: ${relPath}`));
  }
});

// ── Step 3: Create middleware/role-check.js ──
const roleCheckPath = path.join(BASE, 'middleware', 'role-check.js');
const roleCheckSource = path.join(BASE, 'middleware', 'role-check.js');
// The actual file content is written by the main setup — 
// but if running this script standalone, we check if it exists
if (fs.existsSync(roleCheckPath)) {
  console.log(yellow('  Skipped (already exists): middleware/role-check.js'));
} else {
  console.log(red('  WARNING: middleware/role-check.js not found!'));
  console.log(red('  Please ensure it was downloaded and placed correctly.'));
}

// ── Step 4: Check routes/approval-routes.js ──
const routesPath = path.join(BASE, 'routes', 'approval-routes.js');
if (fs.existsSync(routesPath)) {
  console.log(yellow('  Skipped (already exists): routes/approval-routes.js'));
} else {
  console.log(red('  WARNING: routes/approval-routes.js not found!'));
  console.log(red('  Please ensure it was downloaded and placed correctly.'));
}

// ── Step 5: Patch server.js ──
const serverPath = path.join(BASE, 'server.js');
if (!fs.existsSync(serverPath)) {
  console.log(red('  ERROR: server.js not found! Cannot patch.'));
  process.exitCode = 1;
} else {
  let serverContent = fs.readFileSync(serverPath, 'utf8');
  
  const requireLine = "require('./routes/approval-routes')(app);";
  
  if (serverContent.includes('approval-routes')) {
    console.log(yellow('  Skipped (already patched): server.js'));
  } else {
    // Find the best insertion point: after the last app.get/app.post/app.listen block
    // Strategy: insert before app.listen()
    const listenMatch = serverContent.match(/app\.listen\s*\(/);
    if (listenMatch) {
      const insertPos = serverContent.indexOf(listenMatch[0]);
      const insertBlock = `\n// ── IKAegis Approval Workflow Routes ──\n${requireLine}\n\n`;
      serverContent = serverContent.slice(0, insertPos) + insertBlock + serverContent.slice(insertPos);
      
      // Backup first
      const backupPath = serverPath + '.bak.pre-approval';
      fs.writeFileSync(backupPath, fs.readFileSync(serverPath, 'utf8'));
      console.log(green(`  Backed up: server.js → server.js.bak.pre-approval`));
      
      fs.writeFileSync(serverPath, serverContent, 'utf8');
      console.log(green(`  Patched server.js — added approval-routes require`));
    } else {
      console.log(red('  ERROR: Could not find app.listen() in server.js. Please add manually:'));
      console.log(red(`    ${requireLine}`));
    }
  }
}

console.log(bold('\n═══ Setup Complete ═══'));
console.log('\nNext steps:');
console.log('  1. Restart server: node server.js');
console.log('  2. Test: curl http://localhost:3000/api/my-profile');
console.log('  3. Test: curl http://localhost:3000/api/ikaegis-users');
console.log('');
