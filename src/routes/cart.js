const router = require('express').Router();
const pool = require('../config/db');
const { authRequired } = require('../middleware/auth');
const { HttpError, wrap } = require('../utils/http');

router.use(authRequired);

async function getCart(userId) {
  const [items] = await pool.query(
    `SELECT c.cart_id, c.product_id, c.quantity,
            p.product, p.selling_price, p.stock_quantity, p.vendor_id, u.name AS vendor_name
     FROM cart c
     JOIN product p ON p.product_id = c.product_id
     JOIN user u ON u.user_id = p.vendor_id
     WHERE c.user_id = ?
     ORDER BY c.created_at DESC`,
    [userId]
  );
  const total = items.reduce((sum, it) => sum + it.selling_price * it.quantity, 0);
  return { items, total };
}

// GET /api/cart
router.get('/', wrap(async (req, res) => {
  res.json({ success: true, data: await getCart(req.user.user_id) });
}));

// POST /api/cart — { product_id, quantity } (adds to existing row if present)
router.post('/', wrap(async (req, res) => {
  const { product_id, quantity } = req.body || {};
  const qty = Number(quantity || 1);
  if (!product_id || qty < 1) throw new HttpError(400, 'Valid product and quantity are required.');
  const [products] = await pool.query(
    'SELECT product_id, product, stock_quantity, vendor_id FROM product WHERE product_id = ?',
    [product_id]
  );
  if (!products.length) throw new HttpError(404, 'Product not found.');
  const product = products[0];
  // Selling is strictly vendor → their verified clients.
  if (!req.user.vendor_ids || !req.user.vendor_ids.includes(Number(product.vendor_id))) {
    throw new HttpError(403, 'This product is not available to your account.');
  }

  const [existing] = await pool.query(
    'SELECT quantity FROM cart WHERE user_id = ? AND product_id = ?',
    [req.user.user_id, product_id]
  );
  const newQty = (existing.length ? existing[0].quantity : 0) + qty;
  if (newQty > product.stock_quantity) {
    throw new HttpError(
      400,
      `Only ${product.stock_quantity} in stock for "${product.product}".`
    );
  }

  await pool.query(
    `INSERT INTO cart (user_id, product_id, quantity, created_by) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), updated_by = ?`,
    [req.user.user_id, product_id, newQty, req.user.user_id, req.user.user_id]
  );
  res.status(201).json({ success: true, data: await getCart(req.user.user_id) });
}));

// PUT /api/cart/:id — { quantity }
router.put('/:id', wrap(async (req, res) => {
  const qty = Number((req.body || {}).quantity);
  if (!Number.isInteger(qty) || qty < 1) throw new HttpError(400, 'Quantity must be at least 1.');
  const [rows] = await pool.query(
    `SELECT c.cart_id, c.product_id, p.product, p.stock_quantity
     FROM cart c JOIN product p ON p.product_id = c.product_id
     WHERE c.cart_id = ? AND c.user_id = ?`,
    [req.params.id, req.user.user_id]
  );
  if (!rows.length) throw new HttpError(404, 'Cart item not found.');
  if (qty > rows[0].stock_quantity) {
    throw new HttpError(400, `Only ${rows[0].stock_quantity} in stock for "${rows[0].product}".`);
  }
  await pool.query(
    'UPDATE cart SET quantity = ?, updated_by = ? WHERE cart_id = ? AND user_id = ?',
    [qty, req.user.user_id, req.params.id, req.user.user_id]
  );
  res.json({ success: true, data: await getCart(req.user.user_id) });
}));

// DELETE /api/cart/:id
router.delete('/:id', wrap(async (req, res) => {
  const [result] = await pool.query(
    'DELETE FROM cart WHERE cart_id = ? AND user_id = ?',
    [req.params.id, req.user.user_id]
  );
  if (!result.affectedRows) throw new HttpError(404, 'Cart item not found.');
  res.json({ success: true, data: await getCart(req.user.user_id) });
}));

module.exports = router;