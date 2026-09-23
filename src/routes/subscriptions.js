const router = require('express').Router();
const pool = require('../config/db');
const { authRequired } = require('../middleware/auth');
const { wrap } = require('../utils/http');

router.use(authRequired);

// GET /api/subscriptions — available plans
router.get('/', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT subscription_id, plan, best_for, number_of_clients, number_of_products, price, validity_days
     FROM subscription ORDER BY price ASC`
  );
  res.json({ success: true, data: rows });
}));

// POST /api/subscriptions/purchase — disabled.
// Plans are no longer self-purchased: the user contacts +91 9447263743 and an
// admin activates the subscription manually (directly in the database, until an
// admin dashboard exists). The endpoint is kept so old clients get a clear
// message instead of a 404.
router.post('/purchase', (req, res) => {
  res.status(403).json({
    success: false,
    message: 'Self-purchase is disabled. Contact +91 9447263743 to activate a plan — our team will enable it on your account.',
  });
});

module.exports = router;