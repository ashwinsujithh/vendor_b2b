const router = require('express').Router();
const pool = require('../config/db');
const { authRequired } = require('../middleware/auth');
const { HttpError, wrap, todayStr, dayStr } = require('../utils/http');

router.use(authRequired);

// Shared delivery OTP shown to the buyer at checkout; the vendor must enter it
// on the Order Requests page to mark the order delivered.
const deliveryOtp = () => '123456';

/**
 * POST /api/checkout — { address_id }
 * 1. Validates stock for every cart item.
 * 2. Groups items by vendor and enforces each vendor's number_of_clients limit.
 * 3. Creates one checkout row, one order per vendor, order items and clears
 *    the cart — all in one transaction. Stock is NOT deducted here: it moves
 *    once the vendor confirms the order (see routes/orders.js).
 */
router.post('/', wrap(async (req, res) => {
  const { address_id } = req.body || {};
  if (!address_id) throw new HttpError(400, 'Please select a delivery address.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // --- cart items with product info ---
    const [cartRows] = await conn.query(
      `SELECT c.cart_id, c.product_id, c.quantity AS cart_qty,
              p.vendor_id, p.product, p.selling_price, p.stock_quantity
       FROM cart c JOIN product p ON p.product_id = c.product_id
       WHERE c.user_id = ?`,
      [req.user.user_id]
    );
    if (!cartRows.length) throw new HttpError(400, 'Your cart is empty.');

    // --- vendor → client rule: sell only to your verified clients ---
    for (const item of cartRows) {
      if (!req.user.vendor_ids || !req.user.vendor_ids.includes(Number(item.vendor_id))) {
        throw new HttpError(403, `"${item.product}" is not available to your account.`);
      }
    }

    // --- stock check ---
    for (const item of cartRows) {
      if (item.stock_quantity < item.cart_qty) {
        throw new HttpError(400, `Not enough stock for "${item.product}" (${item.stock_quantity} left).`);
      }
    }

    // --- group by vendor ---
    const byVendor = {};
    for (const item of cartRows) {
      (byVendor[item.vendor_id] = byVendor[item.vendor_id] || []).push(item);
    }

    // --- enforce each vendor's number_of_clients limit ---
    for (const vendorId of Object.keys(byVendor)) {
      if (Number(vendorId) === req.user.user_id) continue; // own products
      const [vendors] = await conn.query(
        `SELECT u.name, u.sub_valid_to, s.number_of_clients
         FROM user u LEFT JOIN subscription s ON s.subscription_id = u.subscription_id
         WHERE u.user_id = ?`,
        [vendorId]
      );
      const vendor = vendors[0];
      // Only enforce while the vendor has an active plan with a client limit.
      const vendorValidTo = dayStr(vendor && vendor.sub_valid_to);
      if (!vendor || !vendorValidTo || vendorValidTo < todayStr()) continue;
      if (vendor.number_of_clients == null) continue;

      const [[{ already }]] = await conn.query(
        'SELECT COUNT(*) AS already FROM `order` WHERE vendor_id = ? AND user_id = ?',
        [vendorId, req.user.user_id]
      );
      if (already > 0) continue; // existing client — no new slot needed

      const [[{ clients }]] = await conn.query(
        'SELECT COUNT(*) AS clients FROM vendor_client WHERE vendor_id = ? AND status = 1 AND (client_id IS NULL OR client_id <> ?)',
        [vendorId, req.user.user_id]
      );
      if (clients >= vendor.number_of_clients) {
        throw new HttpError(
          403,
          `"${vendor.name}" has reached their plan's client limit (${vendor.number_of_clients}). Their products can't be ordered right now.`
        );
      }
    }

    // --- address must belong to the user ---
    const [addrRows] = await conn.query(
      'SELECT address_id FROM address WHERE address_id = ? AND user_id = ?',
      [address_id, req.user.user_id]
    );
    if (!addrRows.length) throw new HttpError(400, 'Invalid delivery address.');

    // --- create checkout ---
    const [checkoutRes] = await conn.query(
      'INSERT INTO checkout (user_id, created_by) VALUES (?, ?)',
      [req.user.user_id, req.user.user_id]
    );
    const checkoutId = checkoutRes.insertId;

    // --- one order per vendor ---
    const orderIds = [];
    for (const vendorId of Object.keys(byVendor)) {
      const items = byVendor[vendorId];
      const total = items.reduce((sum, it) => sum + it.selling_price * it.cart_qty, 0);
      const [orderRes] = await conn.query(
        `INSERT INTO \`order\` (checkout_id, user_id, vendor_id, address_id, total_amount, status, delivery_otp, created_by)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [checkoutId, req.user.user_id, vendorId, address_id, total, deliveryOtp(), req.user.user_id]
      );
      const orderId = orderRes.insertId;
      orderIds.push(orderId);

      for (const item of items) {
        await conn.query(
          `INSERT INTO order_item (order_id, product_id, vendor_id, product_name, quantity, unit_price, total_price, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderId,
            item.product_id,
            vendorId,
            item.product,
            item.cart_qty,
            item.selling_price,
            item.selling_price * item.cart_qty,
            req.user.user_id,
          ]
        );
undefined      }
    }

    await conn.query('DELETE FROM cart WHERE user_id = ?', [req.user.user_id]);
    await conn.commit();
    res.status(201).json({ success: true, data: { order_ids: orderIds, delivery_otp: deliveryOtp() } });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

module.exports = router;