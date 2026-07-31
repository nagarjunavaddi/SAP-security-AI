/**
 * patch-login.js — Removes hardcoded USERS + /api/login from server.js
 * Since approval-routes.js now handles file-based login
 * Run: node patch-login.js
 */
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');
const green = t => `\x1b[32m${t}\x1b[0m`;
const red = t => `\x1b[31m${t}\x1b[0m`;

console.log('\n=== Patching server.js: Remove hardcoded login ===\n');

let content = fs.readFileSync(serverPath, 'utf8');

// Backup
const backup = serverPath + '.bak.pre-login-patch';
fs.writeFileSync(backup, content);
console.log(green(`  Backed up: server.js → ${path.basename(backup)}`));

// 1. Remove the USERS block
const usersMatch = content.match(/\/\/ Hardcoded demo users.*?const USERS = \{[\s\S]*?\};/);
if (usersMatch) {
  content = content.replace(usersMatch[0], '// Login is now handled by routes/approval-routes.js (file-based from data/ikaegis-users.json)');
  console.log(green('  Removed: Hardcoded USERS object'));
} else {
  // Try without the comment
  const usersMatch2 = content.match(/const USERS = \{[\s\S]*?\};/);
  if (usersMatch2) {
    content = content.replace(usersMatch2[0], '// Login is now handled by routes/approval-routes.js (file-based from data/ikaegis-users.json)');
    console.log(green('  Removed: USERS object'));
  } else {
    console.log(red('  USERS object not found — may already be removed'));
  }
}

// 2. Remove the /api/login route
const loginMatch = content.match(/app\.post\('\/api\/login'[\s\S]*?\}\);/);
if (loginMatch) {
  content = content.replace(loginMatch[0], '// /api/login route moved to routes/approval-routes.js');
  console.log(green('  Removed: /api/login route'));
} else {
  console.log(red('  /api/login route not found — may already be removed'));
}

fs.writeFileSync(serverPath, content, 'utf8');
console.log(green('\n  server.js patched successfully!'));
console.log('\n  Restart server: node server.js');
console.log('  Login with: admin / Adm@12345\n');
