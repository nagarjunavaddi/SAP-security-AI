/**
 * patch-create-user-html.js
 * ──────────────────────────────────────────────────────────────
 * Run:  node patch-create-user-html.js
 *
 * Redirects ONLY the single-user create form to the approval
 * workflow. Bulk upload is left completely untouched (it keeps
 * calling /api/create-users-bulk directly, as agreed).
 *
 * Change made (single-user submit handler):
 *   - endpoint  /api/create-user      ->  /api/user-create-requests
 *   - the "Submitting to /api/create-user..." note text
 *   - the "not connected /api/create-user" error text
 *   - success handling now reads the approval response
 *     ({ success, message }) instead of a raw SAP response.
 *
 * - Timestamped backup first
 * - Idempotent: re-run detects the marker and skips
 * ──────────────────────────────────────────────────────────────
 */
const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'create-user.html');
const MARKER = 'IK-APPROVAL-PATCH-APPLIED';

function run() {
  if (!fs.existsSync(FILE)) {
    console.error('ERROR: create-user.html not found next to this script. Place it in the project root.');
    process.exit(1);
  }

  let src = fs.readFileSync(FILE, 'utf8');

  if (src.includes(MARKER)) {
    console.log('Already patched (marker found) - skipping.');
    return;
  }

  // backup
  const stamp  = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = FILE + '.backup-' + stamp;
  fs.writeFileSync(backup, src, 'utf8');
  console.log('Backup written:', path.basename(backup));

  // ── The entire single-user IIFE is replaced with an approval version. ──
  // We locate it by its unique opening comment and the divider comment
  // that immediately follows it in the file.
  const START = '/* ===== Single user create ===== */';
  const END   = '/* ===== Bulk upload ===== */';

  const startIdx = src.indexOf(START);
  const endIdx   = src.indexOf(END);

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    console.error('ERROR: could not locate the single-user script block. No changes made.');
    console.error('  START found:', startIdx !== -1, ' END found:', endIdx !== -1);
    // remove the backup we just made to avoid clutter on a no-op failure
    return;
  }

  const NEW_BLOCK = `/* ===== Single user create ===== */
/* ${MARKER} — now routed through manager approval (/api/user-create-requests) */
(function(){
  const form = document.getElementById('createUserForm');
  const note = document.getElementById('createNote');
  const btn  = document.getElementById('submitBtn');

  // Button label reflects that this now raises a request
  if (btn) btn.textContent = 'Submit for Approval';

  form.addEventListener('submit', function(e){
    e.preventDefault();

    const payload = {
      username: document.getElementById('fUsername').value.trim(),
      lastName: document.getElementById('fLastName').value.trim(),
      password: document.getElementById('fPassword').value
    };

    note.classList.remove('error','success');
    note.classList.add('show');
    note.textContent = 'Submitting request for approval\\u2026';
    btn.disabled = true;

    fetch('/api/user-create-requests', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    })
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        btn.disabled = false;
        if(!ok || !data || data.success === false){
          note.classList.add('error');
          note.textContent = (data && (data.error || data.message)) || 'Request submission failed.';
          return;
        }
        note.classList.add('success');
        note.textContent = data.message ||
          ('Request submitted for ' + payload.username + '. Awaiting manager approval.');
        form.reset();
      })
      .catch(err => {
        btn.disabled = false;
        note.classList.add('error');
        note.textContent = 'Not connected \\u2014 /api/user-create-requests unreachable. ' + err.message;
      });
  });
})();

`;

  src = src.slice(0, startIdx) + NEW_BLOCK + src.slice(endIdx);

  fs.writeFileSync(FILE, src, 'utf8');

  // verify
  const after = fs.readFileSync(FILE, 'utf8');
  const okMarker   = after.includes(MARKER);
  const okEndpoint = after.includes("fetch('/api/user-create-requests'");
  const bulkIntact = after.includes("fetch('/api/create-users-bulk'");

  console.log('\nVerification:');
  console.log('  approval marker present :', okMarker   ? 'YES' : 'NO');
  console.log('  single form -> approval :', okEndpoint ? 'YES' : 'NO');
  console.log('  bulk endpoint intact    :', bulkIntact ? 'YES' : 'NO');
  console.log('\nDONE. Hard-refresh the page (Ctrl+F5) to load the updated script.');
}

run();
