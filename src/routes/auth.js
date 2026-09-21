const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { signToken, createSession, destroySession, loadUser, authRequired } = require('../middleware/auth');
const { HttpError, wrap } = require('../utils/http');

// Registration is disabled: accounts are created by a vendor (with OTP
// verification) and vendor rights are granted by an admin in the database.

/** Never leak session/hash internals to the client. */
function publicUser(user) {
  const { session_token, password_hash, ...rest } = user;
  return rest;
}

// POST /api/auth/login — identifier may be the email OR the mobile number
router.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw new HttpError(400, 'Email/mobile and password are required.');
  const identifier = String(email).trim();
  const [rows] = await pool.query('SELECT * FROM user WHERE email = ? OR reg_phone = ?', [identifier, identifier]);
  const stored = rows[0];
  if (!stored || !(await bcrypt.compare(String(password), stored.password_hash))) {
    throw new HttpError(401, 'Invalid email or password.');
  }
  // is_active is a boolean: 1 = enabled, 0 = admin-disabled (set directly in the DB)
  if (!Number(stored.is_active)) {
    throw new HttpError(403, 'Your account is not enabled yet. Please contact support.');
  }
  // Single-session: issuing a session here terminates the previous one. The
  // new session's id is embedded inside the returned JWT (see signToken).
  await createSession(stored.user_id);
  const user = await loadUser(stored.user_id);
  res.json({ success: true, data: { token: signToken(user), user: publicUser(user) } });
}));

// GET /api/auth/me
router.get('/me', authRequired, wrap(async (req, res) => {
  res.json({ success: true, data: publicUser(req.user) });
}));

// POST /api/auth/logout — ends this session on the server too
router.post('/logout', authRequired, wrap(async (req, res) => {
  await destroySession(req.user.user_id);
  res.json({ success: true, data: { logged_out: true } });
}));

module.exports = router;
