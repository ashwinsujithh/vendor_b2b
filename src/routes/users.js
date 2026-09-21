const router = require('express').Router();
const pool = require('../config/db');
const { authRequired, loadUser } = require('../middleware/auth');
const { HttpError, wrap } = require('../utils/http');

// authRequired is applied per-route (not router.use) so that unknown API
// paths still fall through to the app-level 404 handler instead of 401.

// ---------------- Profile ----------------

// GET /api/profile
router.get('/profile', authRequired, wrap(async (req, res) => {
  res.json({ success: true, data: req.user });
}));

// PUT /api/profile  — { name, alt_phone, email }
router.put('/profile', authRequired, wrap(async (req, res) => {
  const { name, alt_phone, email } = req.body || {};
  if (!name || !email) throw new HttpError(400, 'Name and email are required.');
  const [dups] = await pool.query(
    'SELECT user_id FROM user WHERE email = ? AND user_id <> ?',
    [email, req.user.user_id]
  );
  if (dups.length) throw new HttpError(409, 'That email is already in use.');
  await pool.query(
    'UPDATE user SET name = ?, alt_phone = ?, email = ?, updated_by = ? WHERE user_id = ?',
    [name, alt_phone || null, email, req.user.user_id, req.user.user_id]
  );
  const user = await loadUser(req.user.user_id);
  res.json({ success: true, data: user });
}));

// ---------------- Addresses ----------------

// GET /api/addresses
router.get('/addresses', authRequired, wrap(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM address WHERE user_id = ? ORDER BY created_at DESC',
    [req.user.user_id]
  );
  res.json({ success: true, data: rows });
}));

// POST /api/addresses
router.post('/addresses', authRequired, wrap(async (req, res) => {
  const { address_line_1, address_line_2, city, state, country, pincode } = req.body || {};
  if (!address_line_1 || !city || !state || !pincode) {
    throw new HttpError(400, 'Address line 1, city, state and pincode are required.');
  }
  const [result] = await pool.query(
    `INSERT INTO address (user_id, address_line_1, address_line_2, city, state, country, pincode, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.user_id, address_line_1, address_line_2 || null, city, state, country || 'India', pincode, req.user.user_id]
  );
  const [rows] = await pool.query('SELECT * FROM address WHERE address_id = ?', [result.insertId]);
  res.status(201).json({ success: true, data: rows[0] });
}));

// PUT /api/addresses/:id
router.put('/addresses/:id', authRequired, wrap(async (req, res) => {
  const { address_line_1, address_line_2, city, state, country, pincode } = req.body || {};
  if (!address_line_1 || !city || !state || !pincode) {
    throw new HttpError(400, 'Address line 1, city, state and pincode are required.');
  }
  const [result] = await pool.query(
    `UPDATE address SET address_line_1 = ?, address_line_2 = ?, city = ?, state = ?, country = ?, pincode = ?
     WHERE address_id = ? AND user_id = ?`,
    [address_line_1, address_line_2 || null, city, state, country || 'India', pincode, req.params.id, req.user.user_id]
  );
  if (!result.affectedRows) throw new HttpError(404, 'Address not found.');
  const [rows] = await pool.query('SELECT * FROM address WHERE address_id = ?', [req.params.id]);
  res.json({ success: true, data: rows[0] });
}));

// DELETE /api/addresses/:id
router.delete('/addresses/:id', authRequired, wrap(async (req, res) => {
  const [result] = await pool.query(
    'DELETE FROM address WHERE address_id = ? AND user_id = ?',
    [req.params.id, req.user.user_id]
  );
  if (!result.affectedRows) throw new HttpError(404, 'Address not found.');
  res.json({ success: true, data: { deleted: true } });
}));

module.exports = router;