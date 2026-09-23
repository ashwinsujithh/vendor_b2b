/* Demo data seeder.
   Usage:  node seed.js          (skips if data already exists)
           node seed.js --force  (re-inserts demo users/products)
*/
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./src/config/db');

const days = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

async function main() {
  const [[{ plans }]] = await pool.query('SELECT COUNT(*) AS plans FROM subscription');
  if (plans === 0) {
    console.error('Subscription plans are missing. Import schema.sql first (it seeds plans & categories).');
    process.exit(1);
  }
  if (!process.argv.includes('--force')) {
    const [[{ users }]] = await pool.query('SELECT COUNT(*) AS users FROM user');
    if (users > 0) {
      console.log('Demo data already present — nothing to do (use --force to re-seed).');
      process.exit(0);
    }
  }

  const passwordHash = await bcrypt.hash('demo1234', 10);

  // --- find plan + category ids ---
  const [plansRows] = await pool.query("SELECT subscription_id FROM subscription WHERE plan = 'Gold'");
  const goldId = plansRows[0].subscription_id;
  const catId = async (name) => {
    const [rows] = await pool.query('SELECT category_id FROM category WHERE category = ?', [name]);
    return rows[0].category_id;
  };

  // --- users ---
  // is_active: 1 = enabled, 0 = admin-disabled (set directly in the DB).
  // The customer is the vendor's client — vendor→client selling scope.
  const [vendorRes] = await pool.query(
    `INSERT INTO user (name, reg_phone, alt_phone, email, password_hash, is_active, subscription_id, sub_valid_from, sub_valid_to)
     VALUES ('Sundar Traders', '9876500001', '9876500001', 'sundar.traders@gmail.com', ?, 1, ?, ?, ?)`,
    [passwordHash, goldId, days(-10), days(20)]
  );
  const vendorId = vendorRes.insertId;

  const [userRes] = await pool.query(
    `INSERT INTO user (name, reg_phone, alt_phone, email, password_hash, is_active)
     VALUES ('Meera Krishnan', '9876500002', NULL, 'meera.krishnan@gmail.com', ?, 1)`,
    [passwordHash]
  );
  const userId = userRes.insertId;

  // The demo customer is Sundar Traders' verified client (vendor_client pair).
  await pool.query(
    'INSERT INTO vendor_client (vendor_id, client_id, status, created_by) VALUES (?, ?, 1, ?)',
    [vendorId, userId, vendorId]
  );

  // --- products ---
  const products = [
    ['Wireless Mouse', 'Ergonomic 2.4GHz wireless mouse with silent clicks.', 'Electronics', '1 nos', 499, 25],
    ['Organic Green Tea (200g)', 'Single-estate organic green tea leaves.', 'Groceries & Food', '200 gram', 299, 40],
    ['Cotton T-Shirt (M)', '100% combed cotton, regular fit.', 'Fashion', '1 nos', 599, 30],
    ['Steel Water Bottle (1L)', 'Double-wall insulated steel bottle.', 'Home & Kitchen', '1 nos', 399, 20],
  ];
  const productIds = {};
  for (const [name, desc, cat, qty, price, stock] of products) {
    const [r] = await pool.query(
      `INSERT INTO product (vendor_id, category_id, product, description, quantity, selling_price, date, stock_quantity, created_by)
       VALUES (?, ?, ?, ?, ?, ?, CURDATE(), ?, ?)`,
      [vendorId, await catId(cat), name, desc, qty, price, stock, vendorId]
    );
    productIds[name] = r.insertId;
  }

  // --- second vendor (demonstrates a shared client across vendors) ---
  const [fmRes] = await pool.query(
    `INSERT INTO user (name, reg_phone, alt_phone, email, password_hash, is_active, subscription_id, sub_valid_from, sub_valid_to)
     VALUES ('FreshMart Supermarket', '9876500011', NULL, 'freshmart.india@gmail.com', ?, 1, ?, ?, ?)`,
    [passwordHash, goldId, days(-5), days(60)]
  );
  const fmVendorId = fmRes.insertId;
  const fmProducts = [
    ['Basmati Rice (5kg)', 'Aged extra-long grain basmati rice.', 'Groceries & Food', '5kg', 649, 35],
    ['Cold Pressed Coconut Oil (1L)', 'Wood-pressed virgin coconut oil.', 'Groceries & Food', '1 litre', 449, 22],
    ['Cotton Kurta (L)', 'Handloom cotton kurta with side pockets.', 'Fashion', '1 nos', 899, 18],
    ['Notebook (200 pages)', 'A5 ruled notebook with soft cover.', 'Books & Stationery', '1 nos', 120, 60],
  ];
  for (const [name, desc, cat, qty, price, stock] of fmProducts) {
    const [r] = await pool.query(
      `INSERT INTO product (vendor_id, category_id, product, description, quantity, selling_price, date, stock_quantity, created_by)
       VALUES (?, ?, ?, ?, ?, ?, CURDATE(), ?, ?)`,
      [fmVendorId, await catId(cat), name, desc, qty, price, stock, fmVendorId]
    );
    productIds[name] = r.insertId;
  }

  // --- third vendor (their products stay hidden from clients not linked to them) ---
  const [baseRows] = await pool.query("SELECT subscription_id FROM subscription WHERE plan = 'Base'");
  const [tnRes] = await pool.query(
    `INSERT INTO user (name, reg_phone, alt_phone, email, password_hash, is_active, subscription_id, sub_valid_from, sub_valid_to)
     VALUES ('TechNest Electronics', '9876500012', NULL, 'technest.store@gmail.com', ?, 1, ?, ?, ?)`,
    [passwordHash, baseRows[0].subscription_id, days(-5), days(60)]
  );
  const [tnProduct] = await pool.query(
    `INSERT INTO product (vendor_id, category_id, product, description, quantity, selling_price, date, stock_quantity, created_by)
     VALUES (?, ?, 'USB-C Fast Charger (20W)', 'Compact 20W PD fast charger.', '1 nos', 799, CURDATE(), 40, ?)`,
    [tnRes.insertId, await catId('Electronics'), tnRes.insertId]
  );
  productIds['USB-C Fast Charger (20W)'] = tnProduct.insertId;

  // --- address ---
  const [addrRes] = await pool.query(
    `INSERT INTO address (user_id, address_line_1, address_line_2, city, state, country, pincode, created_by)
     VALUES (?, '221B Baker Street', 'MG Road', 'Bengaluru', 'Karnataka', 'India', '560001', ?)`,
    [userId, userId]
  );
  const addressId = addrRes.insertId;

  // --- one past order (delivered) so order history + vendor client count are non-empty ---
  const [checkoutRes] = await pool.query(
    'INSERT INTO checkout (user_id, created_by) VALUES (?, ?)', [userId, userId]
  );
  const checkoutId = checkoutRes.insertId;

  const [orderRes] = await pool.query(
    `INSERT INTO \`order\` (checkout_id, user_id, vendor_id, address_id, total_amount, status, created_by)
     VALUES (?, ?, ?, ?, 798.00, 'delivered', ?)`,
    [checkoutId, userId, vendorId, addressId, userId]
  );
  const orderId = orderRes.insertId;

  const orderItems = [
    [orderId, productIds['Wireless Mouse'], 1, 499.00],
    [orderId, productIds['Organic Green Tea (200g)'], 1, 299.00],
  ];
  for (const [oid, pid, qty, price] of orderItems) {
    await pool.query(
      `INSERT INTO order_item (order_id, product_id, vendor_id, product_name, quantity, unit_price, total_price, created_by)
       SELECT ?, ?, ?, product, ?, ?, ?, ? FROM product WHERE product_id = ?`,
      [oid, pid, vendorId, qty, price, price * qty, userId, pid]
    );
  }

  // --- one item in the demo user's cart, ready to check out ---
  await pool.query(
    'INSERT INTO cart (user_id, product_id, quantity, created_by) VALUES (?, ?, 1, ?)',
    [userId, productIds['Steel Water Bottle (1L)'], userId]
  );

  console.log('Seeded demo data:');
  console.log('  Vendors → sundar.traders@gmail.com · freshmart.india@gmail.com / demo1234');
  console.log('  Client  → meera.krishnan@gmail.com / demo1234    (Sundar\'s verified client)');
  console.log('  9 products (4+4+1 across vendors), 1 past order, 1 cart item ready for checkout.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});