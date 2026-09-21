const router = require('express').Router();
const { addDays, addMonths, todayStr } = require('../utils/dates');
const pool = require('../config/db');
const { authRequired, loadUser } = require('../middleware/auth');
const { HttpError, wrap } = require('../utils/http');

router.use(authRequired);

// GET /api/subscriptions — available plans
router.get('/', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT subscription_id, plan, number_of_clients, number_of_products, price, validity_days
     FROM subscription ORDER BY price ASC`
  );
  res.json({ success: true, data: rows });
}));

// POST /api/subscriptions/purchase — { subscription_id }
// Buying a plan makes the user a Vendor for validity_days, starting TODAY.
// 30-day plans tick one calendar month (same day next month); other
// validity_days counts are added as plain days. Upgrading or renewing always
// replaces the current window — nothing is queued for later.
router.post('/purchase', wrap(async (req, res) => {
  const { subscription_id } = req.body || {};
  if (!subscription_id) throw new HttpError(400, 'Please select a plan.');
  const [plans] = await pool.query('SELECT * FROM subscription WHERE subscription_id = ?', [subscription_id]);
  if (!plans.length) throw new HttpError(404, 'Plan not found.');
  const plan = plans[0];

  const from = todayStr();
  const to = plan.validity_days === 30 ? addMonths(from, 1) : addDays(from, plan.validity_days);

  await pool.query(
    `UPDATE user SET subscription_id = ?, sub_valid_from = ?, sub_valid_to = ?, updated_by = ?
     WHERE user_id = ?`,
    [plan.subscription_id, from, to, req.user.user_id, req.user.user_id]
  );
  const user = await loadUser(req.user.user_id);
  res.json({ success: true, data: user });
}));

module.exports = router;