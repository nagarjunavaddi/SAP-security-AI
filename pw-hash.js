// pw-hash.js — IK-SEC bcrypt hashing with SHA-256 backward-compat (additive)
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const BCRYPT_ROUNDS = 10;

// Old scheme (legacy) — used only to verify pre-migration passwords.
function sha256(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

// New scheme — call this whenever creating/resetting a password.
async function hash(pw) {
  return bcrypt.hash(pw, BCRYPT_ROUNDS);
}

// Detect stored-hash scheme.
function isBcrypt(stored) {
  return typeof stored === 'string' && /^\$2[aby]\$/.test(stored);
}

// Verify a plaintext password against a stored hash of EITHER scheme.
async function verify(pw, stored) {
  if (!stored) return false;
  if (isBcrypt(stored)) {
    try { return await bcrypt.compare(pw, stored); } catch { return false; }
  }
  // legacy SHA-256 (unsalted hex)
  return stored === sha256(pw);
}

// True when a correct password is still stored under the old scheme
// (caller should re-hash and persist to migrate the user).
function needsUpgrade(stored) {
  return !isBcrypt(stored);
}

module.exports = { hash, verify, needsUpgrade, isBcrypt };
