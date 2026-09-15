// routes/user-lock-routes.js  (additive)
const express = require('express');
const router = express.Router();
const { setUserLock } = require('../user-lock');

// POST /api/user-lock  { username, action }
router.post('/api/user-lock', async (req, res) => {
  try {
    const { username, action } = req.body || {};
    if (!username) return res.status(400).json({ ok: false, error: 'username is required' });
    const act = String(action || 'LOCK').toUpperCase();
    if (act !== 'LOCK' && act !== 'UNLOCK') {
      return res.status(400).json({ ok: false, error: "action must be 'LOCK' or 'UNLOCK'" });
    }
    const result = await setUserLock(username, act);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;