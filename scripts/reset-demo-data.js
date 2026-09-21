/* Reset demo data.
   Keeps: user, subscription.
   Wipes: address, cart, checkout, `order`, order_item, delivery_status,
          product, product_image, product_specification, category, client_verification
          (+ deletes product upload files that are no longer referenced).
   Fills: categories, dummy users (3 vendors + 3 customers), products with
          generated product images (SVG files on disk + DB rows) and specifications.

   Usage: node scripts/reset-demo-data.js          (dry summary first)
          node scripts/reset-demo-data.js --yes    (actually run)
*/
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');

const APPLY = process.argv.includes('--yes');
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'products');

const CATEGORIES = [
  'Electronics', 'Groceries & Food', 'Fashion', 'Home & Kitchen',
  'Books & Stationery', 'Sports & Fitness',
];

// [name, category, qty/unit, price, stock, description]
const PRODUCTS = [
  ['Wireless Mouse', 'Electronics', '1 nos', 499.00, 25, 'Ergonomic 2.4GHz wireless mouse with silent clicks and USB receiver.'],
  ['Bluetooth Headphones', 'Electronics', '1 nos', 1499.00, 12, 'Over-ear wireless headphones with 30-hour battery life.'],
  ['USB-C Fast Charger (20W)', 'Electronics', '1 nos', 649.00, 40, 'Compact 20W PD charger compatible with phones and tablets.'],
  ['Organic Green Tea (200g)', 'Groceries & Food', '200 gram', 299.00, 45, 'Single-estate organic green tea leaves, lightly oxidised.'],
  ['Basmati Rice (5kg)', 'Groceries & Food', '5kg', 620.00, 18, 'Aged long-grain basmati rice, extra slim grain.'],
  ['Cold Pressed Coconut Oil (1L)', 'Groceries & Food', '1 litre', 480.00, 22, 'Wood-pressed virgin coconut oil, no additives.'],
  ['Cotton T-Shirt (M)', 'Fashion', '1 nos', 599.00, 30, '100% combed cotton regular-fit tee, pre-shrunk.'],
  ['Running Shoes (UK 9)', 'Fashion', '1 pair', 2199.00, 8, 'Lightweight mesh running shoes with cushioned sole.'],
  ['Cotton Kurta (L)', 'Fashion', '1 nos', 899.00, 15, 'Handloom cotton kurta with wooden buttons.'],
  ['Steel Water Bottle (1L)', 'Home & Kitchen', '1 nos', 399.00, 35, 'Double-wall vacuum insulated stainless-steel bottle.'],
  ['Non-stick Pan (24cm)', 'Home & Kitchen', '1 nos', 1099.00, 10, 'Induction-compatible non-stick pan with glass lid.'],
  ['Storage Jars (Set of 3)', 'Home & Kitchen', '3 nos', 749.00, 16, 'Airtight borosilicate jars with bamboo lids.'],
  ['Notebook (200 pages)', 'Books & Stationery', '1 nos', 120.00, 60, 'A5 hardbound notebook, 80 GSM ruled pages.'],
  ['Gel Pen Set (Pack of 10)', 'Books & Stationery', '10 nos', 180.00, 50, 'Quick-dry 0.5mm gel pens, blue ink.'],
  ['Yoga Mat (6mm)', 'Sports & Fitness', '1 nos', 899.00, 20, 'Anti-skid TPE yoga mat with carry strap.'],
  ['Adjustable Dumbbell (5kg)', 'Sports & Fitness', '1 nos', 1299.00, 6, 'Vinyl-coated adjustable dumbbell, single piece.'],
  ['Smart LED Bulb (9W)', 'Electronics', '1 nos', 249.00, 35, 'WiFi-enabled dimmable LED bulb, 16M colours, app control.'],
  ['Power Bank (10000mAh)', 'Electronics', '1 nos', 999.00, 20, 'Slim 10000mAh power bank with dual USB output.'],
  ['Wireless Keyboard', 'Electronics', '1 nos', 899.00, 14, 'Compact wireless keyboard with whisper-quiet keys.'],
  ['HDMI Cable (1.5m)', 'Electronics', '1.5 metre', 199.00, 60, 'High-speed HDMI 2.0 cable, supports 4K@60Hz.'],
  ['Whole Wheat Atta (5kg)', 'Groceries & Food', '5kg', 285.00, 40, 'Stone-ground whole wheat flour, 100% chakki fresh.'],
  ['Almonds (250g)', 'Groceries & Food', '250 gram', 340.00, 25, 'Premium California almonds, crisp and fresh.'],
  ['Masala Chai (500g)', 'Groceries & Food', '500 gram', 260.00, 30, 'Assam CTC tea blended with cardamom and ginger.'],
  ['Honey (500g)', 'Groceries & Food', '500 gram', 450.00, 18, 'Raw unpasteurised multi-flora honey, NMR tested.'],
  ['Denim Jeans (32)', 'Fashion', '1 nos', 1299.00, 12, 'Slim-fit stretchable denim, mid-rise, deep indigo wash.'],
  ['Casual Sneakers (UK 8)', 'Fashion', '1 pair', 1799.00, 9, 'Everyday sneakers with memory-foam insole.'],
  ['Silk Scarf', 'Fashion', '1 nos', 649.00, 22, 'Pure mulberry silk scarf with hand-rolled edges.'],
  ['Leather Wallet', 'Fashion', '1 nos', 799.00, 17, 'Genuine leather bi-fold wallet with RFID blocking.'],
  ['Ceramic Dinner Set (16 pc)', 'Home & Kitchen', '16 nos', 1899.00, 7, 'Chip-resistant ceramic dinner set, microwave safe.'],
  ['Electric Kettle (1.5L)', 'Home & Kitchen', '1 nos', 949.00, 13, 'Stainless-steel kettle with auto shut-off, 1500W.'],
  ['Cotton Bedsheet (Queen)', 'Home & Kitchen', '1 nos', 799.00, 20, '144 TC pure cotton double bedsheet with 2 pillow covers.'],
  ['Scented Candle Set', 'Home & Kitchen', '4 nos', 449.00, 28, 'Soy-wax candles in lavender, vanilla, sandal and rose.'],
  ['The Alchemist (Paperback)', 'Books & Stationery', '1 nos', 299.00, 45, 'Paulo Coelho classic, English paperback edition.'],
  ['Ball Pen Pack (Blue, 20)', 'Books & Stationery', '20 nos', 150.00, 70, 'Smooth-flow ball pens, 0.7mm, blue ink, pack of 20.'],
  ['Sticky Notes Set', 'Books & Stationery', '1 set', 99.00, 80, 'Assorted neon sticky notes, 76×76mm, 100 sheets each.'],
  ['Desk Organizer', 'Books & Stationery', '1 nos', 549.00, 11, 'Wooden desk caddy with 5 compartments and phone stand.'],
  ['Resistance Bands Set', 'Sports & Fitness', '5 nos', 599.00, 24, 'Five latex loop bands from 10–50 lbs with carry pouch.'],
  ['Football (Size 5)', 'Sports & Fitness', '1 nos', 749.00, 15, 'Machine-stitched match football, butyl bladder.'],
  ['Skipping Rope', 'Sports & Fitness', '1 nos', 199.00, 50, 'Adjustable speed rope with ball-bearing handles.'],
  ['Dumbbell Set (2×5kg)', 'Sports & Fitness', '2 nos', 1899.00, 8, 'Pair of rubber-coated 5kg dumbbells with chrome handles.'],
];

// Two specification lines per product: [title, value] pairs.
const SPECS = {
  'Wireless Mouse': [['Connectivity', '2.4GHz USB receiver'], ['Battery', '1 × AA (included)']],
  'Bluetooth Headphones': [['Battery life', 'Up to 30 hours'], ['Driver', '40mm dynamic']],
  'USB-C Fast Charger (20W)': [['Output', '20W Power Delivery'], ['Port', 'USB-C × 1']],
  'Organic Green Tea (200g)': [['Type', 'Whole leaf'], ['Shelf life', '12 months']],
  'Basmati Rice (5kg)': [['Grain', 'Extra long'], ['Origin', 'Punjab, India']],
  'Cold Pressed Coconut Oil (1L)': [['Extraction', 'Wood pressed'], ['Volume', '1000 ml']],
  'Cotton T-Shirt (M)': [['Fabric', '100% combed cotton'], ['Fit', 'Regular']],
  'Running Shoes (UK 9)': [['Upper', 'Breathable mesh'], ['Sole', 'EVA cushioned']],
  'Cotton Kurta (L)': [['Fabric', 'Handloom cotton'], ['Sleeve', '3/4th']],
  'Steel Water Bottle (1L)': [['Capacity', '1000 ml'], ['Material', 'Stainless steel 304']],
  'Non-stick Pan (24cm)': [['Diameter', '24 cm'], ['Coating', 'PFOA-free non-stick']],
  'Storage Jars (Set of 3)': [['Material', 'Borosilicate glass'], ['Capacities', '500 ml / 750 ml / 1 L']],
  'Notebook (200 pages)': [['Size', 'A5'], ['Pages', '200 ruled, 80 GSM']],
  'Gel Pen Set (Pack of 10)': [['Tip', '0.5 mm'], ['Ink', 'Blue, quick-dry']],
  'Yoga Mat (6mm)': [['Thickness', '6 mm'], ['Material', 'TPE, anti-skid']],
  'Adjustable Dumbbell (5kg)': [['Weight', '5 kg'], ['Coating', 'Vinyl']],
  'Smart LED Bulb (9W)': [['Wattage', '9 W (equivalent 60 W)'], ['Connectivity', 'WiFi, app + voice']],
  'Power Bank (10000mAh)': [['Capacity', '10000 mAh'], ['Output', 'Dual USB, 2.4A']],
  'Wireless Keyboard': [['Connectivity', '2.4GHz USB dongle'], ['Battery', '2 × AAA (not included)']],
  'HDMI Cable (1.5m)': [['Length', '1.5 metre'], ['Version', 'HDMI 2.0, 4K@60Hz']],
  'Whole Wheat Atta (5kg)': [['Type', 'Whole wheat, chakki ground'], ['Shelf life', '6 months']],
  'Almonds (250g)': [['Origin', 'California, USA'], ['Shelf life', '9 months']],
  'Masala Chai (500g)': [['Blend', 'Assam CTC + spices'], ['Shelf life', '12 months']],
  'Honey (500g)': [['Type', 'Raw, multi-flora'], ['Shelf life', '24 months']],
  'Denim Jeans (32)': [['Fabric', 'Stretchable denim'], ['Rise', 'Mid-rise, slim fit']],
  'Casual Sneakers (UK 8)': [['Upper', 'Knit mesh'], ['Insole', 'Memory foam']],
  'Silk Scarf': [['Fabric', 'Mulberry silk'], ['Size', '70 × 70 cm']],
  'Leather Wallet': [['Material', 'Genuine leather'], ['Features', '8 card slots, RFID block']],
  'Ceramic Dinner Set (16 pc)': [['Pieces', '16 (dinner plates, katoris, bowls)'], ['Safe for', 'Microwave, dishwasher']],
  'Electric Kettle (1.5L)': [['Capacity', '1.5 litre'], ['Power', '1500 W, auto shut-off']],
  'Cotton Bedsheet (Queen)': [['Size', 'Queen, 224 × 254 cm'], ['Thread count', '144 TC, 100% cotton']],
  'Scented Candle Set': [['Wax', 'Soy wax'], ['Burn time', '≈ 15 hours each']],
  'The Alchemist (Paperback)': [['Author', 'Paulo Coelho'], ['Pages', '208']],
  'Ball Pen Pack (Blue, 20)': [['Tip', '0.7 mm'], ['Ink', 'Blue, pack of 20']],
  'Sticky Notes Set': [['Size', '76 × 76 mm'], ['Sheets', '100 per pad']],
  'Desk Organizer': [['Material', 'Engineered wood'], ['Compartments', '5 + phone stand']],
  'Resistance Bands Set': [['Levels', '10–50 lbs (5 bands)'], ['Material', 'Natural latex']],
  'Football (Size 5)': [['Size', '5 (match)'], ['Bladder', 'Butyl, air-lock']],
  'Skipping Rope': [['Length', 'Adjustable up to 3 m'], ['Handles', 'Ball-bearing, foam grip']],
  'Dumbbell Set (2×5kg)': [['Weight', '2 × 5 kg'], ['Coating', 'Rubber, chrome handle']],
};

// Three dummy vendors (with active subscriptions) + three plain customers.
// `parent` links a customer to the vendor they buy from (client relationship).
const USERS = [
  // name, email, phone, role, plan, parentEmail
  ['FreshMart Supermarket', 'freshmart.india@gmail.com', '9876500011', 'vendor', 'Gold', null],
  ['TechNest Electronics', 'technest.store@gmail.com', '9876500012', 'vendor', 'Silver', null],
  ['StyleHub Fashion', 'stylehub.fashion@gmail.com', '9876500013', 'vendor', 'Premium', null],
  ['Aarav Sharma', 'aarav.sharma@gmail.com', '9876500021', 'customer', null, 'freshmart.india@gmail.com'],
  ['Diya Patel', 'diya.patel@gmail.com', '9876500022', 'customer', null, 'freshmart.india@gmail.com'],
  ['Rohan Nair', 'rohan.nair@gmail.com', '9876500023', 'customer', null, 'technest.store@gmail.com'],
];

/* Generate a clean SVG product image (soft colour field, no text overlays —
   the UI already labels the product) and save it to the uploads dir.
   Returns the served path for product_image.image_url. */
function makeImage(name, color, idx) {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  // Deterministic per-variant layout so the two images of a product read as
  // related shots without embedding any text.
  const shift = idx === 2 ? 95 : 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".18"/>
      <stop offset="1" stop-color="${color}" stop-opacity=".05"/>
    </linearGradient>
  </defs>
  <rect width="480" height="480" fill="url(#bg)"/>
  <circle cx="${150 + shift}" cy="${160 + (idx === 2 ? 20 : 0)}" r="118" fill="${color}" opacity=".16"/>
  <circle cx="${350 - shift}" cy="335" r="150" fill="${color}" opacity=".11"/>
  <circle cx="240" cy="${235 + (idx === 2 ? 25 : 0)}" r="84" fill="${color}" opacity=".32"/>
  <circle cx="240" cy="${235 + (idx === 2 ? 25 : 0)}" r="50" fill="${color}" opacity=".42"/>
</svg>`;
  const file = `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${idx}.svg`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), svg);
  return `/uploads/products/${file}`;
}

const PALETTE = ['#159b69', '#2563eb', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];

async function main() {
  const [[{ plans }]] = await pool.query('SELECT COUNT(*) AS plans FROM subscription');
  if (!plans) {
    console.error('subscription table is empty — import schema.sql first.');
    process.exit(1);
  }

  const tables = ['delivery_status', 'order_item', '`order`', 'checkout', 'cart', 'client_verification', 'vendor_client',
    'product_specification', 'product_image', 'product', 'address', 'category'];
  const existing = [];
  for (const t of tables) {
    try { await pool.query(`SELECT 1 FROM ${t} LIMIT 1`); existing.push(t); } catch { /* table not present */ }
  }

  console.log(`Dry run — tables to wipe: ${existing.join(', ')}`);
  console.log('user and subscription are kept.');
  if (!APPLY) { console.log('Re-run with --yes to apply.'); process.exit(0); }

  // 1. Wipe (FK checks off — TRUNCATE is refused on FK-referenced tables otherwise).
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of existing) await pool.query(`TRUNCATE TABLE ${t}`);
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');

  // 2. Delete uploaded product files that are no longer referenced (all of them now).
  if (fs.existsSync(UPLOAD_DIR)) {
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, f)); } catch { /* best effort */ }
    }
  }

  // 3. Categories.
  for (const c of CATEGORIES) await pool.query('INSERT INTO category (category) VALUES (?)', [c]);

  // 4. Dummy users (password demo1234 for all).
  const hash = await bcrypt.hash('demo1234', 10);
  const [planRows] = await pool.query('SELECT subscription_id, plan FROM subscription');
  const planId = (name) => planRows.find((p) => p.plan === name)?.subscription_id;
  const ids = { vendor1: 1, vendor2: 2 }; // replaced below with real insertIds
  const vendorIds = [];
  const customerIds = [];
  for (const [name, email, phone, role, plan, parentEmail] of USERS) {
    const [found] = await pool.query('SELECT user_id FROM user WHERE email = ?', [email]);
    let id;
    if (found.length) {
      id = found[0].user_id; // reuse existing dummy user on re-runs
    } else {
      // is_active: 1 = enabled, 0 = admin-disabled (set directly in the DB)
      const [r] = await pool.query(
        `INSERT INTO user (name, reg_phone, alt_phone, email, password_hash, is_active, subscription_id, sub_valid_from, sub_valid_to)
         VALUES (?, ?, NULL, ?, ?, 1, ?, ?, ?)`,
        [name, phone, email, hash,
          plan ? planId(plan) : null,
          plan ? days(-5) : null,
          plan ? days(60) : null]
      );
      id = r.insertId;
    }
    if (role === 'vendor') vendorIds.push(id);
    else customerIds.push(id);
  }
  // Wire the client relationships via vendor_client pairs (verified).
  // Meera-style sharing: Aarav & Diya → FreshMart, Rohan → TechNest, and the
  // seeded vendor (id 1) keeps its own clients through seed.js pairs.
  for (const [, email, , , , parentEmail] of USERS) {
    if (!parentEmail) continue;
    const [[me]] = await pool.query('SELECT user_id FROM user WHERE email = ?', [email]);
    const [[parent]] = await pool.query('SELECT user_id FROM user WHERE email = ?', [parentEmail]);
    if (me && parent) {
      await pool.query(
        `INSERT INTO vendor_client (vendor_id, client_id, status, created_by)
         VALUES (?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE status = 1, updated_by = VALUES(created_by)`,
        [parent.user_id, me.user_id, me.user_id]
      );
    }
  }
  // Existing seeded users (vendor1=1, user1=2) are kept as-is from previous data.
  // Include the original Demo Vendor (user_id 1) in the product rotation.
  vendorIds.unshift(1);

  // 5. Products + images + specs, spread across the three vendors.
  let colorIdx = 0;
  const productIds = {};
  for (let i = 0; i < PRODUCTS.length; i++) {
    const [name, cat, qty, price, stock, desc] = PRODUCTS[i];
    const vendorId = vendorIds[i % vendorIds.length];
    const color = PALETTE[colorIdx++ % PALETTE.length];
    const [r] = await pool.query(
      `INSERT INTO product (vendor_id, category_id, product, description, quantity, selling_price, date, stock_quantity, created_by)
       VALUES (?, (SELECT category_id FROM category WHERE category = ?), ?, ?, ?, ?, CURDATE(), ?, ?)`,
      [vendorId, cat, name, desc, qty, price, stock, vendorId]
    );
    const pid = r.insertId;
    productIds[name] = pid;

    // 2 images per product (generated SVG files on disk, paths in DB).
    for (let idx = 1; idx <= 2; idx++) {
      const url = makeImage(name, color, idx);
      await pool.query(
        'INSERT INTO product_image (product_id, image_url, is_primary, sort_order, created_by) VALUES (?, ?, ?, ?, ?)',
        [pid, url, idx === 1 ? 1 : 0, idx, vendorId]
      );
    }

    // Specifications.
    for (const [title, spec] of SPECS[name] || []) {
      await pool.query(
        'INSERT INTO product_specification (product_id, title, spec, created_by) VALUES (?, ?, ?, ?)',
        [pid, title, spec, vendorId]
      );
    }
  }

  console.log('Reset complete:');
  const [[pc]] = await pool.query('SELECT COUNT(*) AS n FROM product');
  const [[ic]] = await pool.query('SELECT COUNT(*) AS n FROM product_image');
  const [[sc]] = await pool.query('SELECT COUNT(*) AS n FROM product_specification');
  const [[cc]] = await pool.query('SELECT COUNT(*) AS n FROM category');
  const [[uc]] = await pool.query('SELECT COUNT(*) AS n FROM user');
  const [[oc]] = await pool.query('SELECT COUNT(*) AS n FROM `order`');
  console.log(`  categories=${cc.n} products=${pc.n} images=${ic.n} specs=${sc.n} users=${uc.n} orders=${oc.n}`);
  process.exit(0);
}

function days(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

main().catch((err) => { console.error('Reset failed:', err.message); process.exit(1); });
