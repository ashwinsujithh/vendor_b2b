/*
 * Migrates the subscription table to the 2026 pricing lineup:
 *
 *   Base         ₹999    / 30 days  (10 products,  5 clients)  — was Silver
 *   Gold         ₹10,999 / 365 days (25 products, 15 clients)
 *   Business     ₹19,999 / 365 days (60 products, 40 clients)  — was Premium
 *   Professional ₹34,999 / 365 days (150 products, 100 clients) — new
 *   Enterprise   ₹59,999 / 365 days (500 products, 300 clients)
 *
 * Rows are updated in place (old plan name → new values) so existing
 * user.subscription_id references keep pointing at the right plan — Silver
 * holders become Base holders, Gold stays Gold, etc. Professional is inserted.
 *
 * Safe to re-run: renames match by old name (no-ops once applied) and the
 * insert is guarded by a NOT EXISTS check. Also adds the best_for column if
 * the database predates it.
 *
 * Run:  node scripts/update-plans.js
 */
require('dotenv').config({ quiet: true });
require('../src/config/dns-fix');
const mysql = require('mysql2/promise');

const PLANS = [
  { plan: 'Base', best_for: 'Small/new vendors', clients: 5, products: 10, price: 999, days: 30, was: 'Silver' },
  { plan: 'Gold', best_for: 'Growing businesses', clients: 15, products: 25, price: 10999, days: 365, was: 'Gold' },
  { plan: 'Business', best_for: 'Established businesses', clients: 40, products: 60, price: 19999, days: 365, was: 'Premium' },
  { plan: 'Professional', best_for: 'Large businesses', clients: 100, products: 150, price: 34999, days: 365, was: null },
  { plan: 'Enterprise', best_for: 'High-volume businesses', clients: 300, products: 500, price: 59999, days: 365, was: 'Enterprise' },
];

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'storepanel',
    ssl: process.env.DB_SSL ? { rejectUnauthorized: false } : undefined,
    multipleStatements: true,
  });

  // 1. best_for column (MySQL 8 has no ADD COLUMN IF NOT EXISTS — check first).
  const [cols] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscription' AND COLUMN_NAME = 'best_for'`
  );
  if (!cols[0].n) {
    await conn.query("ALTER TABLE subscription ADD COLUMN best_for VARCHAR(100) NULL AFTER plan");
    console.log('✔ added column best_for');
  } else {
    console.log('• best_for already exists');
  }

  // 2. Rename/update old rows in place.
  for (const p of PLANS) {
    if (!p.was || p.was === p.plan) continue;
    const [r] = await conn.query(
      `UPDATE subscription SET plan = ?, best_for = ?, number_of_clients = ?, number_of_products = ?, price = ?, validity_days = ?
       WHERE plan = ?`,
      [p.plan, p.best_for, p.clients, p.products, p.price, p.days, p.was]
    );
    console.log(r.affectedRows ? `✔ ${p.was} → ${p.plan}` : `• no row named ${p.was} (already migrated)`);
  }

  // 3. Update values for renamed-in-place plans whose name did not change
  //    (Gold, Enterprise) and insert brand-new plans.
  for (const p of PLANS) {
    const [r] = await conn.query(
      `UPDATE subscription SET best_for = ?, number_of_clients = ?, number_of_products = ?, price = ?, validity_days = ?
       WHERE plan = ? AND (number_of_clients <> ? OR number_of_products <> ? OR price <> ? OR validity_days <> ?)`,
      [p.best_for, p.clients, p.products, p.price, p.days, p.plan, p.clients, p.products, p.price, p.days]
    );
    if (r.affectedRows) console.log(`✔ ${p.plan} values updated`);

    if (!p.was || p.was === p.plan) {
      const [ins] = await conn.query(
        `INSERT INTO subscription (plan, best_for, number_of_clients, number_of_products, price, validity_days)
         SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM subscription WHERE plan = ?)`,
        [p.plan, p.best_for, p.clients, p.products, p.price, p.days, p.plan]
      );
      if (ins.affectedRows) console.log(`✔ inserted ${p.plan}`);
    }
  }

  const [rows] = await conn.query(
    'SELECT subscription_id, plan, best_for, number_of_clients, number_of_products, price, validity_days FROM subscription ORDER BY price ASC'
  );
  console.log('\nCurrent plans:');
  for (const r of rows) {
    console.log(`  #${r.subscription_id} ${r.plan.padEnd(14)} ₹${Number(r.price).toLocaleString('en-IN')} / ${r.validity_days}d — ${r.number_of_products} products, ${r.number_of_clients} clients — ${r.best_for}`);
  }

  await conn.end();
})().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
