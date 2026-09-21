const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { HttpError, todayStr, dayStr } = require('../utils/http');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function signToken(user) {
  // The session id hash rides inside the JWT: an old token keeps the previous
  // session's id, which no longer matches after a newer login (or logout).
  return jwt.sign({ user_id: user.user_id, sid: user.session_token || null }, JWT_SECRET, { expiresIn: '7d' });
}

/** Session ids: a fresh random id per login. Only its sha256 is stored. */
function sessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Issue a new session for the user: persists the hashed session id so that
 * previously issued tokens are rejected on the next request (one device at a
 * time — a new login terminates the old session). The raw id is embedded in
 * the JWT by signToken (JWTs are signed, so the client cannot forge it).
 */
async function createSession(userId) {
  const sid = sessionToken();
  await pool.query('UPDATE user SET session_token = ? WHERE user_id = ?', [hashToken(sid), userId]);
  return sid;
}

/** Any new login/session drops the stored token — used by logout. */
async function destroySession(userId) {
  await pool.query('UPDATE user SET session_token = NULL WHERE user_id = ?', [userId]);
}

/**
 * Load a user with subscription info and compute the is_vendor flag.
 * A user is a Vendor while an admin has enabled them (is_active = 1) AND they
 * hold a subscription whose validity window covers today.
 */
async function loadUser(userId) {
  const [rows] = await pool.query(
    `SELECT u.user_id, u.name, u.reg_phone, u.alt_phone, u.email, u.is_active,
            u.session_token,
            u.subscription_id, u.sub_valid_from, u.sub_valid_to,
            s.plan, s.number_of_clients, s.number_of_products, s.validity_days
     FROM user u
     LEFT JOIN subscription s ON s.subscription_id = u.subscription_id
     WHERE u.user_id = ?`,
    [userId]
  );
  if (!rows.length) return null;
  const u = rows[0];
  const validTo = dayStr(u.sub_valid_to);
  const validFrom = dayStr(u.sub_valid_from);
  u.sub_valid_to = validTo;
  u.sub_valid_from = validFrom;
  // Vendor rights require an admin-enabled account with a plan that has
  // started AND not expired.
  u.is_vendor = !!(
    Number(u.is_active) === 1 &&
    u.subscription_id &&
    validFrom && validFrom <= todayStr() &&
    validTo && validTo >= todayStr()
  );
  // Vendors this account is a verified client of (drives product visibility).
  const [vcRows] = await pool.query(
    'SELECT vendor_id FROM vendor_client WHERE client_id = ? AND status = 1',
    [u.user_id]
  );
  u.vendor_ids = vcRows.map((r) => r.vendor_id);
  return u;
}

/** Shared session checks. Returns an error message string, or null when valid. */
function sessionError(user, payload) {
  if (Number(user.is_active) !== 1) return 'Account disabled. Please contact support.';
  if (!user.session_token) return 'Your session has ended, please log in again.';
  if (payload.sid !== user.session_token) return 'You have been signed out — your account was logged in on another device.';
  return null;
}

async function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Please log in.');
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      throw new HttpError(401, 'Session expired, please log in again.');
    }
    const user = await loadUser(payload.user_id);
    if (!user) throw new HttpError(401, 'Account not found.');
    const sessionIssue = sessionError(user, payload);
    if (sessionIssue) throw new HttpError(401, sessionIssue);
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Attach req.user when a valid Bearer token is present; never reject.
 * Used by public browsing endpoints that personalise results for the caller.
 */
async function authOptional(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next();
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return next();
    }
    const user = await loadUser(payload.user_id);
    if (user && Number(user.is_active) === 1 && user.session_token && payload.sid === user.session_token) req.user = user;
  } catch {
    // stay anonymous on any failure
  }
  next();
}

function requireVendor(req, res, next) {
  if (!req.user || !req.user.is_vendor) {
    return next(new HttpError(403, 'Vendor access required. Your account must be vendor-enabled and hold an active plan.'));
  }
  next();
}

module.exports = { signToken, sessionToken, hashToken, createSession, destroySession, loadUser, authRequired, authOptional, requireVendor };
