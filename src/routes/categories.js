const router = require('express').Router();
const pool = require('../config/db');
const { authRequired, requireVendor } = require('../middleware/auth');
const { HttpError, wrap } = require('../utils/http');

router.use(authRequired);

// GET /api/categories — any logged-in user (needed for product form dropdowns)
router.get('/', wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM category ORDER BY category ASC');
  res.json({ success: true, data: rows });
}));

// Vendor-only management below
router.use(requireVendor);

// GET /api/categories/fuzzy?q=... — resolve a typed category name against the
// existing list (exact > token-subset > similar >= 50% overlap). Returns the
// winning category or null so the vendor can create it knowingly.
const { matchCategory } = require('../utils/category-match');
router.get('/fuzzy', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ success: true, data: null });
  const [rows] = await pool.query('SELECT category_id, category FROM category');
  res.json({ success: true, data: matchCategory(q, rows) });
}));

// POST /api/categories
router.post('/', wrap(async (req, res) => {
  const { category } = req.body || {};
  if (!category || !String(category).trim()) throw new HttpError(400, 'Category name is required.');
  try {
    const [result] = await pool.query(
      'INSERT INTO category (category, created_by) VALUES (?, ?)',
      [String(category).trim(), req.user.user_id]
    );
    const [rows] = await pool.query('SELECT * FROM category WHERE category_id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'That category already exists.');
    throw err;
  }
}));

// PUT /api/categories/:id
router.put('/:id', wrap(async (req, res) => {
  const { category } = req.body || {};
  if (!category || !String(category).trim()) throw new HttpError(400, 'Category name is required.');
  try {
    const [result] = await pool.query(
      'UPDATE category SET category = ?, updated_by = ? WHERE category_id = ?',
      [String(category).trim(), req.user.user_id, req.params.id]
    );
    if (!result.affectedRows) throw new HttpError(404, 'Category not found.');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'That category already exists.');
    throw err;
  }
  const [rows] = await pool.query('SELECT * FROM category WHERE category_id = ?', [req.params.id]);
  res.json({ success: true, data: rows[0] });
}));

// DELETE /api/categories/:id
router.delete('/:id', wrap(async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM category WHERE category_id = ?', [req.params.id]);
    if (!result.affectedRows) throw new HttpError(404, 'Category not found.');
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
      throw new HttpError(409, 'Cannot delete: products are assigned to this category.');
    }
    throw err;
  }
  res.json({ success: true, data: { deleted: true } });
}));

module.exports = router;