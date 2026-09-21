const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { authRequired, requireVendor } = require('../middleware/auth');
const { HttpError, wrap } = require('../utils/http');

/**
 * Client adding works on (vendor, client) PAIRS stored in vendor_client:
 *   client_id NULL + staged_reg_phone → a pending invite for a mobile number.
 *   client_id set + status 0          → linked account, awaiting this vendor's OTP.
 *   client_id set + status 1          → verified client of this vendor.
 * Existence of the mobile is deliberately NOT revealed when the invite is
 * created — only at OTP verification:
 *   - known mobile  → the existing account is linked to this vendor.
 *   - unknown mobile→ the account is created on the spot (then the vendor is
 *     asked to add the client's address).
 */

let verificationTableReady;

function ensureVerificationTable() {
  if (!verificationTableReady) {
    verificationTableReady = pool.query(`CREATE TABLE IF NOT EXISTS client_verification (
      client_verification_id INT AUTO_INCREMENT PRIMARY KEY,
      vendor_client_id INT NOT NULL,
      otp_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      attempt_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_client_verification_pair (vendor_client_id),
      CONSTRAINT fk_client_verification_pair FOREIGN KEY (vendor_client_id) REFERENCES vendor_client(vendor_client_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).then(() => undefined);
  }
  return verificationTableReady;
}

// Dummy OTP for now — a fixed code until a real SMS provider is wired in.
// otp_hash/verify still run the full sha256 + expiry + attempt-limit flow.
const DUMMY_OTP = '123456';
// Brand-new clients start with this shared password; the vendor hands it over
// with the client's mobile. They can change it later from their profile.
const NEW_CLIENT_PASSWORD = 'demo1234';

function otpCode() {
  return DUMMY_OTP;
}

function otpHash(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function normalizePhone(value) {
  const text = String(value || '').trim();
  if (!/^\d{10}$/.test(text)) throw new HttpError(400, 'Enter a valid 10-digit mobile number.');
  return text;
}

async function listPairs(vendorId) {
  const [rows] = await pool.query(
    `SELECT vc.vendor_client_id AS pair_id, vc.client_id, vc.staged_reg_phone, vc.status, vc.created_at,
            u.user_id, u.name, u.email, u.reg_phone, u.alt_phone, u.is_active AS user_is_active
     FROM vendor_client vc
     LEFT JOIN user u ON u.user_id = vc.client_id
     WHERE vc.vendor_id = ?
     ORDER BY vc.vendor_client_id DESC`,
    [vendorId]
  );
  return rows.map((r) => ({
    pair_id: r.pair_id,
    client_id: r.client_id,
    name: r.name || 'Pending verification',
    email: r.email,
    reg_phone: r.reg_phone || r.staged_reg_phone,
    alt_phone: r.alt_phone,
    status: r.status,
    user_is_active: r.user_is_active,
    is_new_account: r.client_id == null,
    created_at: r.created_at,
  }));
}

async function findPair(pairId, vendorId) {
  const pairs = await listPairs(vendorId);
  const pair = pairs.find((p) => p.pair_id === Number(pairId));
  if (!pair) throw new HttpError(404, 'Client not found in your list.');
  return pair;
}

async function issueOtp(pairId) {
  await ensureVerificationTable();
  const code = otpCode();
  await pool.query('DELETE FROM client_verification WHERE vendor_client_id = ?', [pairId]);
  await pool.query(
    'INSERT INTO client_verification (vendor_client_id, otp_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))',
    [pairId, otpHash(code)]
  );
  // No SMS provider yet, so the code is returned to the vendor UI directly.
  return { demo_otp: code };
}

async function ensurePair(vendorId, { clientId = null, stagedPhone = null, createdBy = null } = {}) {
  if (clientId != null) {
    const [existing] = await pool.query(
      'SELECT vendor_client_id, status FROM vendor_client WHERE vendor_id = ? AND client_id = ?',
      [vendorId, clientId]
    );
    if (existing.length) return existing[0];
    const [result] = await pool.query(
      'INSERT INTO vendor_client (vendor_id, client_id, status, created_by) VALUES (?, ?, 0, ?)',
      [vendorId, clientId, createdBy]
    );
    return { vendor_client_id: result.insertId, status: 0 };
  }
  const [existing] = await pool.query(
    'SELECT vendor_client_id, status FROM vendor_client WHERE vendor_id = ? AND staged_reg_phone = ? AND client_id IS NULL',
    [vendorId, stagedPhone]
  );
  if (existing.length) return existing[0];
  const [result] = await pool.query(
    'INSERT INTO vendor_client (vendor_id, client_id, staged_reg_phone, status, created_by) VALUES (?, NULL, ?, 0, ?)',
    [vendorId, stagedPhone, createdBy]
  );
  return { vendor_client_id: result.insertId, status: 0 };
}

async function attachAddress(clientId, vendorId, body) {
  const { address_line_1, address_line_2, city, state, country, pincode } = body || {};
  if (!address_line_1?.trim() || !city?.trim() || !state?.trim() || !pincode?.trim()) {
    throw new HttpError(400, 'Address line 1, city, state and pincode are required.');
  }
  const [result] = await pool.query(
    `INSERT INTO address (user_id, address_line_1, address_line_2, city, state, country, pincode, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [clientId, address_line_1.trim(), address_line_2?.trim() || null, city.trim(), state.trim(), country?.trim() || 'India', pincode.trim(), vendorId]
  );
  const [rows] = await pool.query('SELECT * FROM address WHERE address_id = ?', [result.insertId]);
  return rows[0];
}

router.use(authRequired, requireVendor);

// GET /api/clients
router.get('/', wrap(async (req, res) => {
  res.json({ success: true, data: await listPairs(req.user.user_id) });
}));

// POST /api/clients — stage a client invite by mobile and return the OTP.
// Existence of the number is NOT disclosed here (revealed only at verify).
router.post('/', wrap(async (req, res) => {
  // Mobile-first: only the number is needed to stage an invite and send the
  // OTP. Name, email etc. are collected AFTER the number is verified.
  const { name, email, reg_phone, alt_phone } = req.body || {};
  const phone = normalizePhone(reg_phone);
  const cleanEmail = String(email || '').trim() || null;
  const cleanAlt = String(alt_phone || '').trim() || null;
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new HttpError(400, 'Enter a valid email address.');
  }
  const [[{ pair_count }]] = await pool.query(
    'SELECT COUNT(*) AS pair_count FROM vendor_client WHERE vendor_id = ? AND status = 1',
    [req.user.user_id]
  );
  const [known] = await pool.query('SELECT user_id, is_active FROM user WHERE reg_phone = ?', [phone]);
  if (known.length) {
    // Existing user — a second pending pair for them would burn a plan slot
    // for a link that may never be verified.
    if (cleanEmail) {
      const [emailOwner] = await pool.query('SELECT user_id FROM user WHERE email = ? AND user_id <> ?', [cleanEmail, known[0].user_id]);
      if (emailOwner.length) throw new HttpError(409, 'Another account already uses that email.');
    }
    const [already] = await pool.query(
      'SELECT vendor_client_id FROM vendor_client WHERE vendor_id = ? AND client_id = ?',
      [req.user.user_id, known[0].user_id]
    );
    if (already.length) throw new HttpError(409, 'This mobile number is already in your client list.');
  } else if (pair_count >= req.user.number_of_clients) {
    throw new HttpError(403, `Your ${req.user.plan} plan allows ${req.user.number_of_clients} clients.`);
  }
  const pair = known.length
    ? await ensurePair(req.user.user_id, { clientId: known[0].user_id, createdBy: req.user.user_id })
    : await ensurePair(req.user.user_id, { stagedPhone: phone, createdBy: req.user.user_id });
  res.status(201).json({
    success: true,
    data: {
      pair_id: pair.vendor_client_id,
      status: pair.status,
      reg_phone: phone,
      ...(await issueOtp(pair.vendor_client_id)),
    },
  });
}));

// PUT /api/clients/:pairId — update details of a linked client.
// reg_phone is optional: it is only changed when explicitly provided (the
// mobile is the verified identity, the post-verify details form omits it).
router.put('/:pairId', wrap(async (req, res) => {
  const pair = await findPair(req.params.pairId, req.user.user_id);
  if (pair.client_id == null) throw new HttpError(400, 'Verify this client first, then edit their details.');
  const { name, email, reg_phone, alt_phone } = req.body || {};
  if (!name?.trim()) throw new HttpError(400, 'Client name is required.');
  let phone = null;
  if (reg_phone && String(reg_phone).trim()) {
    phone = normalizePhone(reg_phone);
    const [dups] = await pool.query('SELECT user_id FROM user WHERE reg_phone = ? AND user_id <> ?', [phone, pair.client_id]);
    if (dups.length) throw new HttpError(409, 'Another account already uses that mobile number.');
  }
  if (email?.trim()) {
    const [emailDups] = await pool.query('SELECT user_id FROM user WHERE email = ? AND user_id <> ?', [email.trim(), pair.client_id]);
    if (emailDups.length) throw new HttpError(409, 'Another account already uses that email.');
  }
  await pool.query(
    'UPDATE user SET name = ?, email = ?, reg_phone = COALESCE(?, reg_phone), alt_phone = ?, updated_by = ? WHERE user_id = ?',
    [name.trim(), email?.trim() || null, phone, alt_phone?.trim() || null, req.user.user_id, pair.client_id]
  );
  res.json({ success: true, data: await findPair(pair.pair_id, req.user.user_id) });
}));

// POST /api/clients/:pairId/send-otp — replaces the previous short-lived code
router.post('/:pairId/send-otp', wrap(async (req, res) => {
  const pair = await findPair(req.params.pairId, req.user.user_id);
  if (Number(pair.status) === 1) throw new HttpError(409, 'This client is already verified.');
  res.json({ success: true, data: await issueOtp(pair.vendor_client_id) });
}));

// POST /api/clients/:pairId/verify — { code }.
// OTP expires after 10 minutes and allows five attempts. Existence is resolved
// HERE: a known mobile links the existing account; an unknown one creates it.
router.post('/:pairId/verify', wrap(async (req, res) => {
  const pair = await findPair(req.params.pairId, req.user.user_id);
  const code = String(req.body?.code || '');
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Enter the six-digit OTP.');
  await ensureVerificationTable();
  const [rows] = await pool.query(
    'SELECT * FROM client_verification WHERE vendor_client_id = ? ORDER BY created_at DESC LIMIT 1',
    [pair.pair_id]
  );
  if (!rows.length || new Date(rows[0].expires_at) < new Date()) {
    throw new HttpError(400, 'OTP expires after 10 minutes. Request a new code.');
  }
  if (rows[0].attempt_count >= 5) throw new HttpError(429, 'Too many invalid OTP attempts. Request a new code.');
  const actual = Buffer.from(otpHash(code));
  const expected = Buffer.from(rows[0].otp_hash);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    await pool.query('UPDATE client_verification SET attempt_count = attempt_count + 1 WHERE client_verification_id = ?', [rows[0].client_verification_id]);
    throw new HttpError(400, 'Incorrect OTP.');
  }
  await pool.query('DELETE FROM client_verification WHERE vendor_client_id = ?', [pair.pair_id]);

  let existingAccount = pair.client_id != null;
  let clientId = pair.client_id;

  if (clientId == null) {
    // Unknown-at-stage mobile: resolve now. Another vendor may have created
    // the account between staging and verifying — handle both races.
    const phone = pair.reg_phone;
    const [knownNow] = await pool.query('SELECT user_id, is_active FROM user WHERE reg_phone = ?', [phone]);
    if (knownNow.length) {
      clientId = knownNow[0].user_id;
      existingAccount = true;
      const [racing] = await pool.query(
        'SELECT vendor_client_id, status FROM vendor_client WHERE vendor_id = ? AND client_id = ?',
        [req.user.user_id, clientId]
      );
      if (racing.length && racing[0].vendor_client_id !== pair.pair_id) {
        // A staged invite got linked first — retire this duplicate pair.
        await pool.query('DELETE FROM vendor_client WHERE vendor_client_id = ?', [pair.pair_id]);
        if (Number(racing[0].status) === 1) {
          return res.json({ success: true, data: { ...await findPair(racing[0].vendor_client_id, req.user.user_id), existing_account: true, address_pending: false, needs_details: false } });
        }
        await pool.query('UPDATE vendor_client SET status = 1, updated_by = ? WHERE vendor_client_id = ?', [req.user.user_id, racing[0].vendor_client_id]);
        return res.json({ success: true, data: { ...await findPair(racing[0].vendor_client_id, req.user.user_id), existing_account: true, address_pending: false, needs_details: false } });
      }
    } else {
      const [created] = await pool.query(
        `INSERT INTO user (name, reg_phone, email, alt_phone, password_hash, is_active, created_by)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        [
          'Client',
          phone,
          null,
          null,
          await bcrypt.hash(NEW_CLIENT_PASSWORD, 10),
          req.user.user_id,
        ]
      );
      clientId = created.insertId;
      existingAccount = false;
    }
    await pool.query('UPDATE vendor_client SET client_id = ?, staged_reg_phone = NULL, status = 1, updated_by = ? WHERE vendor_client_id = ?', [clientId, req.user.user_id, pair.pair_id]);
  } else {
    await pool.query('UPDATE vendor_client SET status = 1, updated_by = ? WHERE vendor_client_id = ?', [req.user.user_id, pair.pair_id]);
    // The account's enabled/disabled state stays admin-controlled — linking
    // and verifying only manages this vendor's pair.
  }

  const fresh = await findPair(pair.pair_id, req.user.user_id);
  const [addr] = await pool.query('SELECT COUNT(*) AS n FROM address WHERE user_id = ?', [clientId]);
  res.json({
    success: true,
    data: {
      ...fresh,
      existing_account: existingAccount,
      // Brand-new clients still need their address captured by the vendor.
      address_pending: !existingAccount && addr[0].n === 0,
      // Brand-new accounts were created from just a mobile number — the vendor
      // is prompted for name/email/address right after verification.
      needs_details: !existingAccount,
    },
  });
}));

// POST /api/clients/:pairId/address — vendor captures the client's address
// after verification (required for a brand-new client, optional otherwise).
router.post('/:pairId/address', wrap(async (req, res) => {
  const pair = await findPair(req.params.pairId, req.user.user_id);
  if (pair.client_id == null) throw new HttpError(400, 'Verify this client before adding an address.');
  if (Number(pair.status) !== 1) throw new HttpError(400, 'Verify this client before adding an address.');
  const address = await attachAddress(pair.client_id, req.user.user_id, req.body);
  res.status(201).json({ success: true, data: { address, client: await findPair(pair.pair_id, req.user.user_id) } });
}));

// DELETE /api/clients/:pairId — remove this vendor's link (account untouched)
router.delete('/:pairId', wrap(async (req, res) => {
  const pair = await findPair(req.params.pairId, req.user.user_id);
  await pool.query('DELETE FROM vendor_client WHERE vendor_client_id = ?', [pair.pair_id]);
  res.json({ success: true, data: { deleted: true } });
}));

module.exports = router;
