const router = require('express').Router();
const pool = require('../config/db');
const { authRequired, requireVendor } = require('../middleware/auth');
const { HttpError, wrap } = require('../utils/http');

router.use(authRequired);

const STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

// Order statuses a vendor may set manually. 'delivered'/'completed' are
// reserved for the OTP handshake (verify-delivery).
const VENDOR_ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'out_for_delivery', 'cancelled'];

// Full 10-state delivery lifecycle used by delivery_status rows.
const DELIVERY_STATUSES = [
  'pending', 'confirmed', 'processing', 'packed', 'shipped',
  'out_for_delivery', 'delivered', 'cancelled', 'returned', 'failed',
];

// GET /api/orders — the buyer's own order history (items carry their delivery record)
router.get('/', wrap(async (req, res) => {
  const [orders] = await pool.query(
    `SELECT o.order_id, o.checkout_id, o.total_amount, o.status, o.delivery_otp, o.vendor_note, o.created_at,
            u.name AS vendor_name, u.reg_phone AS vendor_phone,
            va.address_line_1 AS vendor_address_line_1, va.address_line_2 AS vendor_address_line_2,
            va.city AS vendor_city, va.state AS vendor_state, va.pincode AS vendor_pincode,
            a.address_line_1, a.address_line_2, a.city, a.state, a.pincode
     FROM \`order\` o
     JOIN user u ON u.user_id = o.vendor_id
     LEFT JOIN address va ON va.address_id = (SELECT MIN(va2.address_id) FROM address va2 WHERE va2.user_id = o.vendor_id)
     LEFT JOIN address a ON a.address_id = o.address_id
     WHERE o.user_id = ?
     ORDER BY o.created_at DESC`,
    [req.user.user_id]
  );
  const [items] = await pool.query(
    `SELECT oi.*,
            ds.status AS delivery_status, ds.tracking_number, ds.courier_name,
            ds.shipped_at, ds.expected_delivery_date, ds.delivered_at, ds.delivery_note, ds.updated_at AS delivery_updated_at
     FROM order_item oi
     JOIN \`order\` o ON o.order_id = oi.order_id
     LEFT JOIN delivery_status ds ON ds.order_item_id = oi.order_item_id
     WHERE o.user_id = ?
     ORDER BY oi.order_item_id`,
    [req.user.user_id]
  );
  const byOrder = {};
  for (const it of items) (byOrder[it.order_id] = byOrder[it.order_id] || []).push(it);
  for (const o of orders) o.items = byOrder[o.order_id] || [];
  res.json({ success: true, data: orders });
}));

// GET /api/orders/vendor — orders received for the vendor's products (own purchases excluded)
router.get('/vendor', requireVendor, wrap(async (req, res) => {
  const [orders] = await pool.query(
    `SELECT o.order_id, o.checkout_id, o.total_amount, o.status, o.vendor_note, o.created_at,
            u.name AS customer_name,
            va.address_line_1 AS vendor_address_line_1, va.address_line_2 AS vendor_address_line_2,
            va.city AS vendor_city, va.state AS vendor_state, va.pincode AS vendor_pincode,
            a.address_line_1, a.address_line_2, a.city, a.state, a.pincode
     FROM \`order\` o
     JOIN user u ON u.user_id = o.user_id
     LEFT JOIN address va ON va.address_id = (SELECT MIN(va2.address_id) FROM address va2 WHERE va2.user_id = o.vendor_id)
     LEFT JOIN address a ON a.address_id = o.address_id
     WHERE o.vendor_id = ? AND o.user_id <> ?
     ORDER BY o.created_at DESC`,
    [req.user.user_id, req.user.user_id]
  );
  const [items] = await pool.query(
    `SELECT oi.*,
            ds.status AS delivery_status, ds.tracking_number, ds.courier_name,
            ds.shipped_at, ds.expected_delivery_date, ds.delivered_at, ds.delivery_note
     FROM order_item oi
     LEFT JOIN delivery_status ds ON ds.order_item_id = oi.order_item_id
     WHERE oi.vendor_id = ?
     ORDER BY oi.order_item_id`,
    [req.user.user_id]
  );
  const byOrder = {};
  for (const it of items) (byOrder[it.order_id] = byOrder[it.order_id] || []).push(it);
  for (const o of orders) o.items = byOrder[o.order_id] || [];
  res.json({ success: true, data: orders });
}));

/**
 * Deduct stock for every item of an order, exactly once (stock_deducted flag).
 * Called when the vendor confirms the order.
 */
async function deductStockForOrder(orderId, vendorId, byUser) {
  const [orders] = await pool.query(
    'SELECT order_id, status, stock_deducted FROM `order` WHERE order_id = ? AND vendor_id = ?',
    [orderId, vendorId]
  );
  if (!orders.length) throw new HttpError(404, 'Order not found or not yours.');
  if (orders[0].stock_deducted) return { already: true };
  await pool.query(
    `UPDATE product p JOIN order_item oi ON oi.product_id = p.product_id AND oi.order_id = ?
       SET p.stock_quantity = p.stock_quantity - oi.quantity`,
    [orderId]
  );
  await pool.query('UPDATE `order` SET stock_deducted = 1, updated_by = ? WHERE order_id = ?', [byUser, orderId]);
  return { already: false };
}

/**
 * Restore the stock that was deducted on confirmation (vendor cancels the order).
 * Only fires when this order actually moved stock; each product row is clamped
 * at zero so cancellations can never inflate stock above what really exists.
 */
async function restoreStockForOrder(orderId, vendorId, byUser) {
  const [orders] = await pool.query(
    'SELECT order_id, stock_deducted FROM `order` WHERE order_id = ? AND vendor_id = ?',
    [orderId, vendorId]
  );
  if (!orders.length) throw new HttpError(404, 'Order not found or not yours.');
  if (!orders[0].stock_deducted) return { restored: false };
  await pool.query(
    `UPDATE product p JOIN order_item oi ON oi.product_id = p.product_id AND oi.order_id = ?
       SET p.stock_quantity = GREATEST(p.stock_quantity + oi.quantity, 0)`,
    [orderId]
  );
  await pool.query('UPDATE `order` SET stock_deducted = 0, updated_by = ? WHERE order_id = ?', [byUser, orderId]);
  return { restored: true };
}
// PUT /api/orders/:id/verify-delivery — { otp } the buyer shows at the door.
// Correct OTP → every item's delivery_status becomes 'delivered'
// (stamping delivered_at) and the order itself becomes 'completed'.
router.put('/:id/verify-delivery', requireVendor, wrap(async (req, res) => {
  const orderId = Number(req.params.id);
  const otp = String((req.body || {}).otp || '').trim();
  if (!otp) throw new HttpError(400, 'Please enter the delivery OTP.');

  const [orders] = await pool.query(
    'SELECT order_id, user_id, vendor_id, status, delivery_otp FROM `order` WHERE order_id = ? AND vendor_id = ? AND user_id <> ?',
    [orderId, req.user.user_id, req.user.user_id]
  );
  if (!orders.length) throw new HttpError(404, 'Order not found or not yours.');
  const order = orders[0];
  if (order.status === 'completed') return res.json({ success: true, data: { already: true, status: 'completed' } });
  if (otp !== String(order.delivery_otp || '')) throw new HttpError(400, 'Incorrect OTP — ask the customer for the delivery code.');

  // If this order was never confirmed (straight to OTP), commit its stock now.
  await deductStockForOrder(orderId, req.user.user_id, req.user.user_id);

  let deliveredCount = 0;

  const conn = await pool.getConnection();
  let items = [];
  try {
    await conn.beginTransaction();
    [items] = await conn.query('SELECT order_item_id, product_id FROM order_item WHERE order_id = ?', [orderId]);
    deliveredCount = items.length;
    for (const it of items) {
      await conn.query(
        `INSERT INTO delivery_status
           (order_id, order_item_id, product_id, vendor_id, status, delivered_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, 'delivered', NOW(), ?, ?)
         ON DUPLICATE KEY UPDATE status = 'delivered', delivered_at = NOW(), updated_by = VALUES(updated_by)`,
        [orderId, it.order_item_id, it.product_id, req.user.user_id, req.user.user_id, req.user.user_id]
      );
    }
    await conn.query(
      'UPDATE `order` SET status = \'completed\', updated_by = ? WHERE order_id = ?',
      [req.user.user_id, orderId]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  res.json({ success: true, data: { order_id: orderId, status: 'completed', items_delivered: deliveredCount } });
}));

// PUT /api/orders/:id/status — { status } (vendor updates orders for their products)
router.put('/:id/status', requireVendor, wrap(async (req, res) => {
  const { status } = req.body || {};
  // Vendor can move an order up to 'out_for_delivery' (or cancel it).
  // 'delivered' AND 'completed' are OTP-only — verify-delivery sets them.
  if (!VENDOR_ORDER_STATUSES.includes(status)) {
    throw new HttpError(400, `Status must be one of: ${VENDOR_ORDER_STATUSES.join(', ')}.`);
  }
  const [existing] = await pool.query(
    'SELECT status, stock_deducted FROM `order` WHERE order_id = ? AND vendor_id = ?',
    [req.params.id, req.user.user_id]
  );
  if (!existing.length) throw new HttpError(404, 'Order not found or not yours.');
  // Stock follows the vendor's decision: confirming commits the stock,
  // un-confirming (back to pending) gives it back.
  if (!existing[0].stock_deducted && ['confirmed', 'shipped', 'out_for_delivery', 'completed'].includes(status)) {
    await deductStockForOrder(Number(req.params.id), req.user.user_id, req.user.user_id);
  }
  if (existing[0].stock_deducted && status === 'pending') {
    await restoreStockForOrder(Number(req.params.id), req.user.user_id, req.user.user_id);
  }
  const [result] = await pool.query(
    `UPDATE \`order\` SET status = ?, updated_by = ? WHERE order_id = ? AND vendor_id = ?`,
    [status, req.user.user_id, req.params.id, req.user.user_id]
  );
  if (!result.affectedRows) throw new HttpError(404, 'Order not found or not yours.');
  // Un-cancelling: clear the vendor-cancel stamp so the buyer's track page
  // goes back to a live pipeline instead of stale 'cancelled' item chips.
  if (existing[0].status === 'cancelled' && status !== 'cancelled') {
    await pool.query(
      `UPDATE delivery_status ds
       JOIN order_item oi ON oi.order_item_id = ds.order_item_id
       SET ds.status = ?, ds.delivery_note = NULL, ds.updated_by = ?
       WHERE oi.order_id = ? AND ds.status = 'cancelled' AND ds.delivery_note LIKE 'Cancelled by vendor%'`,
      [status, req.user.user_id, req.params.id]
    );
  }
  res.json({ success: true, data: { order_id: Number(req.params.id), status } });
}));

// PUT /api/orders/:id/cancel — vendor cancels the order. Stamps every item's
// delivery_status row as 'cancelled' (with an optional reason in delivery_note),
// so the buyer's Track Order page can show WHO cancelled and WHY. Reversible:
// cancelling and re-confirming clears the stamp.
router.put('/:id/cancel', requireVendor, wrap(async (req, res) => {
  const orderId = Number(req.params.id);
  const reason = String((req.body || {}).reason || '').trim();

  const [orders] = await pool.query(
    'SELECT order_id FROM `order` WHERE order_id = ? AND vendor_id = ? AND user_id <> ?',
    [orderId, req.user.user_id, req.user.user_id]
  );
  if (!orders.length) throw new HttpError(404, 'Order not found or not yours.');

  // Stock comes back: the vendor cancelling un-commits the order.
  await restoreStockForOrder(orderId, req.user.user_id, req.user.user_id);

  const conn = await pool.getConnection();
  let items = [];
  try {
    await conn.beginTransaction();
    [items] = await conn.query('SELECT order_item_id, product_id FROM order_item WHERE order_id = ?', [orderId]);
    for (const it of items) {
      await conn.query(
        `INSERT INTO delivery_status
           (order_id, order_item_id, product_id, vendor_id, status, delivery_note, created_by, updated_by)
         VALUES (?, ?, ?, ?, 'cancelled', ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = 'cancelled', delivery_note = VALUES(delivery_note), updated_by = VALUES(updated_by)`,
        [orderId, it.order_item_id, it.product_id, req.user.user_id,
         `Cancelled by vendor${reason ? ': ' + reason : ''}`,
         req.user.user_id, req.user.user_id]
      );
    }
    await conn.query('UPDATE `order` SET status = \'cancelled\', updated_by = ? WHERE order_id = ?', [req.user.user_id, orderId]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  res.json({ success: true, data: { order_id: orderId, status: 'cancelled', items_cancelled: items.length } });
}));

// PUT /api/orders/:id/note — { vendor_note } (vendor note for the buyer)
router.put('/:id/note', requireVendor, wrap(async (req, res) => {
  const { vendor_note } = req.body || {};
  const [result] = await pool.query(
    `UPDATE \`order\` SET vendor_note = ?, updated_by = ? WHERE order_id = ? AND vendor_id = ?`,
    [vendor_note || null, req.user.user_id, req.params.id, req.user.user_id]
  );
  if (!result.affectedRows) throw new HttpError(404, 'Order not found or not yours.');
  res.json({ success: true, data: { order_id: Number(req.params.id), vendor_note: vendor_note || null } });
}));

/**
 * PUT /api/orders/:id/items/:itemId/delivery — vendor updates the delivery record
 * of one order item: { status, tracking_number, courier_name,
 * expected_delivery_date, delivery_note }.
 * shipped_at / delivered_at are stamped automatically on those transitions.
 * When every item of the order ends up with the same status, the order's own
 * status is synced to it.
 */
router.put('/:id/items/:itemId/delivery', requireVendor, wrap(async (req, res) => {
  const orderId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const body = req.body || {};

  // 'delivered' is intentionally NOT settable here — it is reserved for the
  // OTP handshake (verify-delivery). Manual updates stop at 'out_for_delivery'.
  const status = body.status || 'pending';
  if (!DELIVERY_STATUSES.includes(status) || status === 'delivered') {
    throw new HttpError(400, `Delivery status must be one of: ${DELIVERY_STATUSES.filter((s) => s !== 'delivered').join(', ')}.`);
  }

  const expectedDate = body.expected_delivery_date
    ? String(body.expected_delivery_date).slice(0, 10)
    : null;
  if (expectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) {
    throw new HttpError(400, 'expected_delivery_date must be YYYY-MM-DD.');
  }

  // The item must belong to this order AND to the requesting vendor.
  const [items] = await pool.query(
    'SELECT order_item_id, product_id FROM order_item WHERE order_item_id = ? AND order_id = ? AND vendor_id = ?',
    [itemId, orderId, req.user.user_id]
  );
  if (!items.length) throw new HttpError(404, 'Order item not found or not yours.');

  // Upsert — a delivery_status row is created on the first update.
  await pool.query(
    `INSERT INTO delivery_status
       (order_id, order_item_id, product_id, vendor_id, status, tracking_number, courier_name,
        shipped_at, expected_delivery_date, delivered_at, delivery_note, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?,
             ${status === 'shipped' ? 'NOW()' : 'NULL'},
             ?,
             ${status === 'delivered' ? 'NOW()' : 'NULL'},
             ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       tracking_number = VALUES(tracking_number),
       courier_name = VALUES(courier_name),
       shipped_at = COALESCE(
         ${status === 'shipped' ? 'NOW()' : 'NULL'},
         shipped_at
       ),
       expected_delivery_date = VALUES(expected_delivery_date),
       delivered_at = COALESCE(
         ${status === 'delivered' ? 'NOW()' : 'NULL'},
         delivered_at
       ),
       delivery_note = VALUES(delivery_note),
       updated_by = VALUES(updated_by)`,
    [
      orderId,
      itemId,
      items[0].product_id,
      req.user.user_id,
      status,
      body.tracking_number ? String(body.tracking_number).trim() : null,
      body.courier_name ? String(body.courier_name).trim() : null,
      expectedDate,
      body.delivery_note ? String(body.delivery_note).trim() : null,
      req.user.user_id,
      req.user.user_id,
    ]
  );

  // Sync the order's own status when all its items agree on one delivery status.
  const [[{ distinct_count, total }]] = await pool.query(
    `SELECT COUNT(DISTINCT ds.status) AS distinct_count, COUNT(oi.order_item_id) AS total
     FROM order_item oi
     LEFT JOIN delivery_status ds ON ds.order_item_id = oi.order_item_id
     WHERE oi.order_id = ?`,
    [orderId]
  );
  if (total > 0 && distinct_count === 1) {
    const [[first]] = await pool.query(
      `SELECT ds.status FROM order_item oi
       JOIN delivery_status ds ON ds.order_item_id = oi.order_item_id
       WHERE oi.order_id = ? LIMIT 1`,
      [orderId]
    );
    // 'delivered' is OTP-only: a stray all-delivered item state never flips
    // the order itself — only verify-delivery sets 'completed'.
    const orderStatus = VENDOR_ORDER_STATUSES.includes(first.status) ? first.status : 'shipped';
    await pool.query(
      'UPDATE `order` SET status = ?, updated_by = ? WHERE order_id = ? AND vendor_id = ?',
      [orderStatus, req.user.user_id, orderId, req.user.user_id]
    );
  }

  const [rows] = await pool.query(
    'SELECT * FROM delivery_status WHERE order_item_id = ?',
    [itemId]
  );
  res.json({ success: true, data: rows[0] });
}));

module.exports = router;
