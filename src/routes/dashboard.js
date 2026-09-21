const router = require('express').Router();
const pool = require('../config/db');
const { authRequired } = require('../middleware/auth');
const { wrap } = require('../utils/http');

router.use(authRequired);

// GET /api/dashboard — role-aware stats + recent orders
router.get('/', wrap(async (req, res) => {
  const u = req.user;
  const data = { is_vendor: u.is_vendor, subscription: null };

  if (u.subscription_id) {
    const validTo = u.sub_valid_to instanceof Date ? u.sub_valid_to.toISOString().slice(0, 10) : String(u.sub_valid_to || '').slice(0, 10);
    const daysLeft = Math.max(0, Math.ceil((new Date(`${validTo}T00:00:00`) - new Date()) / 86400000));
    data.subscription = {
      plan: u.plan,
      sub_valid_from: u.sub_valid_from,
      sub_valid_to: validTo,
      days_left: daysLeft,
    };
  }

  const [[{ order_count }]] = await pool.query(
    'SELECT COUNT(*) AS order_count FROM `order` WHERE user_id = ?',
    [u.user_id]
  );
  data.order_count = order_count;

  const [[{ cart_count }]] = await pool.query(
    'SELECT COUNT(*) AS cart_count FROM cart WHERE user_id = ?',
    [u.user_id]
  );
  data.cart_count = cart_count;

  if (u.is_vendor) {
    const [[{ product_count }]] = await pool.query(
      'SELECT COUNT(*) AS product_count FROM product WHERE vendor_id = ?',
      [u.user_id]
    );
    const [[{ client_count }]] = await pool.query(
      'SELECT COUNT(*) AS client_count FROM vendor_client WHERE vendor_id = ? AND status = 1',
      [u.user_id]
    );
    data.product_count = product_count;
    data.product_limit = u.number_of_products;
    data.client_count = client_count;
    data.client_limit = u.number_of_clients;

    // Low-stock alert: any product at or below 5 units (0 = out of stock).
    const [lowStock] = await pool.query(
      `SELECT product_id, product, stock_quantity
       FROM product
       WHERE vendor_id = ? AND stock_quantity <= 5
       ORDER BY stock_quantity ASC, product ASC
       LIMIT 20`,
      [u.user_id]
    );
    data.low_stock_products = lowStock;

    const [recent] = await pool.query(
      `SELECT o.order_id, o.total_amount, o.status, o.created_at, u.name AS customer_name
       FROM \`order\` o JOIN user u ON u.user_id = o.user_id
       WHERE o.vendor_id = ? ORDER BY o.created_at DESC LIMIT 5`,
      [u.user_id]
    );
    data.recent_orders = recent;
  } else {
    const [recent] = await pool.query(
      `SELECT o.order_id, o.total_amount, o.status, o.created_at, u.name AS vendor_name
       FROM \`order\` o JOIN user u ON u.user_id = o.vendor_id
       WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 5`,
      [u.user_id]
    );
    data.recent_orders = recent;
  }

  res.json({ success: true, data });
}));

module.exports = router;