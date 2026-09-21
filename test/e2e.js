/*
 End-to-end smoke test for StorePanel — fully isolated.

 Creates a throwaway database (storepanel_e2e), loads schema.sql + seed.js
 into it, boots a private app server on port 3100, runs every check against
 that instance, then drops the database and stops the server.

 The dev server and the real `storepanel` database are never touched.

 Run:  node test/e2e.js
*/
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const TEST_PORT = 3100;
const BASE = `http://localhost:${TEST_PORT}`;
const TEST_DB = 'storepanel_e2e';
const ROOT = path.join(__dirname, '..');

function dbConfig(extra = {}) {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    ...extra,
  };
}

function runNode(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${script} exited ${code}:\n${out}`))));
    child.on('error', reject);
  });
}

async function waitForHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Test server did not become healthy on port ${TEST_PORT}`);
}

async function provisionTestDb() {
  const conn = await mysql.createConnection(dbConfig({ multipleStatements: true }));
  await conn.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  await conn.query(`CREATE DATABASE \`${TEST_DB}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${TEST_DB}\``);
  // schema.sql hardcodes `CREATE DATABASE storepanel` / `USE storepanel` — strip
  // those so the statements can never leak into the real database.
  const schema = fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8')
    .replace(/^\s*(CREATE DATABASE|USE)\b[^;]*;\s*$/gim, '');
  await conn.query(schema);
  await conn.end();
  // Seed demo data into the throwaway DB (seed.js reads DB_NAME from env).
  await runNode('seed.js', { DB_NAME: TEST_DB });
}

async function dropTestDb() {
  const conn = await mysql.createConnection(dbConfig());
  await conn.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  await conn.end();
}

let passed = 0;
let failed = 0;
const fails = [];

function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  \u2714 ${name}`); }
  else { failed++; fails.push(name); console.log(`  \u2718 ${name} ${extra}`); }
}

async function call(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

async function callForm(token, path, formData) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

function tinyPng(name) {
  // 1x1 transparent PNG bytes (a real decodable image, 67 bytes)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );
  return new File([png], name, { type: 'image/png' });
}

async function main() {
  console.log(`--- provisioning throwaway db "${TEST_DB}" + server on :${TEST_PORT} ---`);
  await provisionTestDb();
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(TEST_PORT), DB_NAME: TEST_DB },
    stdio: 'ignore',
  });
  try {
    await waitForHealth();
    await runChecks();
  } finally {
    server.kill();
    console.log(`--- dropping ${TEST_DB} ---`);
    await dropTestDb();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (fails.length) { console.log('FAILED:', fails.join(' | ')); process.exitCode = 1; }
}

async function runChecks() {
  console.log('--- auth (login-only, single session) ---');
  const bad = await call(null, 'POST', '/api/auth/login', { email: 'meera.krishnan@gmail.com', password: 'wrong' });
  check('wrong password rejected (401)', bad.status === 401);

  const reg = await call(null, 'POST', '/api/auth/register', {
    name: 'Nope', reg_phone: '9' + String(Date.now()).slice(-9), email: `x${Date.now()}@test.com`, password: 'secret1',
  });
  check('register endpoint removed (404)', reg.status === 404);

  const vendLogin1 = await call(null, 'POST', '/api/auth/login', { email: 'sundar.traders@gmail.com', password: 'demo1234' });
  check('vendor login', vendLogin1.status === 200 && vendLogin1.body.data.user.is_vendor === true);
  const vendLogin2 = await call(null, 'POST', '/api/auth/login', { email: 'sundar.traders@gmail.com', password: 'demo1234' });
  check('second login succeeds', vendLogin2.status === 200);
  const vendor = vendLogin2.body.data.token;

  const stale = await call(vendLogin1.body.data.token, 'GET', '/api/auth/me');
  check('single session: first token terminated by second login (401)', stale.status === 401 && /another device/i.test(stale.body?.message || ''));

  const userLogin = await call(null, 'POST', '/api/auth/login', { email: 'meera.krishnan@gmail.com', password: 'demo1234' });
  check('customer login (not vendor)', userLogin.status === 200 && userLogin.body.data.user.is_vendor === false);
  let cust = userLogin.body.data.token;

  // Admin toggle simulation: status = 0 blocks login entirely.
  const db = await mysql.createConnection(dbConfig({ database: TEST_DB }));
  const [[meeraRow]] = await db.query("SELECT user_id, is_active FROM user WHERE email = 'meera.krishnan@gmail.com'");
  check('user.is_active is boolean (1/0)', [0, 1].includes(Number(meeraRow.is_active)));
  await db.query('UPDATE user SET is_active = 0 WHERE user_id = ?', [meeraRow.user_id]);
  const disabledLogin = await call(null, 'POST', '/api/auth/login', { email: 'meera.krishnan@gmail.com', password: 'demo1234' });
  check('admin-disabled account cannot log in (403)', disabledLogin.status === 403);
  const disabledApi = await call(cust, 'GET', '/api/auth/me');
  check('admin-disabled account is rejected on the API too (401)', disabledApi.status === 401);
  await db.query('UPDATE user SET is_active = 1 WHERE user_id = ?', [meeraRow.user_id]);
  const reLogin = await call(null, 'POST', '/api/auth/login', { email: 'meera.krishnan@gmail.com', password: 'demo1234' });
  check('re-enabled account logs in again', reLogin.status === 200);
  await db.end();
  cust = reLogin.body.data.token;

  console.log('--- role enforcement ---');
  const noVendor = await call(cust, 'GET', '/api/products/mine');
  check('customer blocked from vendor products (403)', noVendor.status === 403);
  const noCat = await call(cust, 'POST', '/api/categories', { category: 'Hacked' });
  check('customer blocked from category CRUD (403)', noCat.status === 403);
  const noTok = await call(null, 'GET', '/api/orders');
  check('missing token rejected (401)', noTok.status === 401);

  console.log('--- clients & dummy OTP ---');
  const newPhone = '9' + String(Date.now()).slice(-9);
  const newEmail = `otp.client.${newPhone}@gmail.com`;
  const clientCreated = await call(vendor, 'POST', '/api/clients', { reg_phone: newPhone });
  check('invite POST accepts mobile only (name/email ignored)', clientCreated.status === 201);
  check('vendor stages client invite by mobile, dummy OTP returned', clientCreated.status === 201 && clientCreated.body.data.demo_otp === '123456');
  const pairId = clientCreated.body.data.pair_id;
  check('new client is pending (status 0)', Number(clientCreated.body.data.status) === 0);
  const wrongOtp = await call(vendor, 'POST', `/api/clients/${pairId}/verify`, { code: '000000' });
  check('wrong OTP rejected (400)', wrongOtp.status === 400);
  const goodOtp = await call(vendor, 'POST', `/api/clients/${pairId}/verify`, { code: '123456' });
  check('dummy OTP 123456 verifies client (status 1)', goodOtp.status === 200 && Number(goodOtp.body.data.status) === 1);
  check('brand-new client reports existing_account: false + address pending', goodOtp.body.data.existing_account === false && goodOtp.body.data.address_pending === true);
  const detailsSaved = await call(vendor, 'PUT', `/api/clients/${pairId}`, { name: 'OTP Client', email: newEmail, alt_phone: '9870098700' });
  check('details form saves name + email + alt phone', detailsSaved.status === 200 && detailsSaved.body.data.email === newEmail && detailsSaved.body.data.alt_phone === '9870098700');
  const clientId = goodOtp.body.data.client_id;

  // Vendor captures the new client's address after verification.
  const clientAddr = await call(vendor, 'POST', `/api/clients/${pairId}/address`, {
    address_line_1: '9 Client Street', city: 'Chennai', state: 'TN', pincode: '600001',
  });
  check('vendor adds client address after verify', clientAddr.status === 201 && clientAddr.body.data.address.city === 'Chennai');

  // Give the verified client a known password so it can sign in as the second buyer.
  const db2 = await mysql.createConnection(dbConfig({ database: TEST_DB }));
  await db2.query('UPDATE user SET password_hash = ? WHERE user_id = ?', [await bcrypt.hash('secret1', 10), clientId]);
  await db2.end();
  const buyerLogin = await call(null, 'POST', '/api/auth/login', { email: newPhone, password: 'secret1' });
  check('verified client can sign in by mobile', buyerLogin.status === 200 && buyerLogin.body.data.user.is_vendor === false);
  const buyer = buyerLogin.body.data.token;

  console.log('--- shared client: second vendor links the SAME mobile ---');
  const fmLogin = await call(null, 'POST', '/api/auth/login', { email: 'freshmart.india@gmail.com', password: 'demo1234' });
  check('second vendor login', fmLogin.status === 200);
  const fm = fmLogin.body.data.token;
  const share = await call(fm, 'POST', '/api/clients', { name: 'OTP Client', reg_phone: newPhone });
  check('second vendor stages the same mobile (201, no duplicate account)', share.status === 201 && share.body.data.pair_id !== pairId);
  const shareVerify = await call(fm, 'POST', `/api/clients/${share.body.data.pair_id}/verify`, { code: '123456' });
  check('second vendor verifies → existing_account: true', shareVerify.status === 200 && shareVerify.body.data.existing_account === true && shareVerify.body.data.address_pending === false);
  const fmList = await call(fm, 'GET', '/api/clients');
  check('second vendor\'s list contains the shared client', fmList.status === 200 && fmList.body.data.some((c) => c.client_id === clientId));

  console.log('--- shared client sees the union of both vendors ---');
  const unionList = await call(buyer, 'GET', '/api/products');
  const vendorNames = [...new Set(unionList.body.data.map((p) => p.vendor_name))];
  check('shared client sees both vendors\' products', unionList.status === 200 && vendorNames.includes('Sundar Traders') && vendorNames.includes('FreshMart Supermarket'), JSON.stringify(vendorNames));
  const sundarCount = unionList.body.data.filter((p) => p.vendor_name === 'Sundar Traders').length;
  const fmCount = unionList.body.data.filter((p) => p.vendor_name === 'FreshMart Supermarket').length;
  check('union has products from BOTH vendors (4 + 4)', sundarCount === 4 && fmCount === 4, `sundar=${sundarCount} fm=${fmCount}`);
  const fmProduct = unionList.body.data.find((p) => p.vendor_name === 'FreshMart Supermarket');
  const crossCart = await call(buyer, 'POST', '/api/cart', { product_id: fmProduct.product_id, quantity: 1 });
  check('shared client can cart from the second vendor', crossCart.status === 201);
  const thirdVendor = await call(null, 'POST', '/api/auth/login', { email: 'technest.store@gmail.com', password: 'demo1234' });
  const tnProducts = await call(thirdVendor.body.data.token, 'GET', '/api/products/mine');
  const outsider = await call(buyer, 'GET', `/api/products/${tnProducts.body.data[0].product_id}`);
  check('non-linked vendor\'s product still hidden (404)', outsider.status === 404);

  console.log('--- profile & addresses ---');
  const prof = await call(buyer, 'PUT', '/api/profile', { name: 'Test Buyer Edited', email: `edited${Date.now()}@test.com` });
  check('profile update', prof.status === 200 && prof.body.data.name === 'Test Buyer Edited');

  const addr = await call(buyer, 'POST', '/api/addresses', {
    address_line_1: '1 Test Lane', city: 'Mumbai', state: 'MH', pincode: '400001',
  });
  check('address create', addr.status === 201);
  const addrId = addr.body.data.address_id;

  console.log('--- vendor→client product visibility ---');
  const anon = await call(null, 'GET', '/api/products');
  check('anonymous browsing disabled (empty list)', anon.status === 200 && anon.body.data.length === 0);
  const vis = await call(cust, 'GET', '/api/products');
  check('client sees only their vendor\'s products', vis.status === 200 && vis.body.data.length === 4 && vis.body.data.every((p) => p.vendor_name === 'Sundar Traders'));
  const visDetail = await call(cust, 'GET', `/api/products/${vis.body.data[0].product_id}`);
  check('client opens vendor product detail (200)', visDetail.status === 200);

  console.log('--- vendor product + plan limit ---');
  const cats = await call(vendor, 'GET', '/api/categories');
  check('categories list (vendor)', cats.status === 200 && cats.body.data.length >= 6);
  const catId = cats.body.data[0].category_id;

  // Derive limits from the vendor's actual plan (Gold = 50 products in seed data)
  const vMe = (await call(vendor, 'GET', '/api/auth/me')).body.data;
  const vLimit = vMe.number_of_products;
  const vMineBefore = (await call(vendor, 'GET', '/api/products/mine')).body.data.length;
  let limitHit = false;
  let lastProduct = null;
  for (let i = 0; i <= vLimit - vMineBefore; i++) {
    const r = await call(vendor, 'POST', '/api/products', {
      product: `Limit Test ${i}`, category_id: catId, selling_price: 10, stock_quantity: 5, quantity: 1,
    });
    if (r.status === 201) lastProduct = r.body.data;
    if (r.status === 403 && /limit/i.test(r.body.message || '')) { limitHit = true; break; }
  }
  check(`product limit enforced at plan max (${vLimit}) (403)`, limitHit);

  const edit = await call(vendor, 'PUT', `/api/products/${lastProduct.product_id}`, {
    product: 'Limit Test Edited', category_id: catId, selling_price: 99, stock_quantity: 3, quantity: 2,
  });
  check('vendor edits own product', edit.status === 200 && edit.body.data.product === 'Limit Test Edited');

  // delete the extra test products to restore seed state
  const mine = await call(vendor, 'GET', '/api/products/mine');
  for (const p of mine.body.data.filter((x) => x.product.startsWith('Limit Test'))) {
    await call(vendor, 'DELETE', `/api/products/${p.product_id}`);
  }
  const mineAfter = await call(vendor, 'GET', '/api/products/mine');
  check('vendor deletes own products (back to 4)', mineAfter.body.data.length === 4);

  const foreign = await call(cust, 'PUT', `/api/products/${lastProduct.product_id}`, {
    product: 'Hijack', category_id: catId, selling_price: 1, stock_quantity: 1,
  });
  check('customer cannot edit vendor product (403/404)', foreign.status === 403 || foreign.status === 404);

  console.log('--- cart & checkout ---');
  const prods = (await call(cust, 'GET', '/api/products')).body.data;
  const target = prods.find((p) => p.stock_quantity >= 3);
  const add = await call(cust, 'POST', '/api/cart', { product_id: target.product_id, quantity: 2 });
  check('add to cart', add.status === 201 && add.body.data.items.length >= 1);

  const cartItem = add.body.data.items.find((i) => i.product_id === target.product_id);
  const upd = await call(cust, 'PUT', `/api/cart/${cartItem.cart_id}`, { quantity: 3 });
  check('update cart quantity', upd.status === 200 && upd.body.data.items.find((i) => i.cart_id === cartItem.cart_id).quantity === 3);

  const overStock = await call(cust, 'PUT', `/api/cart/${cartItem.cart_id}`, { quantity: 99999 });
  check('over-stock quantity rejected (400)', overStock.status === 400);

  // checkout enforces address ownership, so cust needs their own address
  const custAddr = await call(cust, 'POST', '/api/addresses', {
    address_line_1: '5 Customer Avenue', city: 'Delhi', state: 'DL', pincode: '110001',
  });
  check('customer address create', custAddr.status === 201);
  const custAddrId = custAddr.body.data.address_id;

  const co = await call(cust, 'POST', '/api/checkout', { address_id: custAddrId });
  check('checkout creates order(s)', co.status === 201 && co.body.data.order_ids.length >= 1);

  const emptyCo = await call(cust, 'POST', '/api/checkout', { address_id: custAddrId });
  check('empty cart checkout rejected (400)', emptyCo.status === 400);

  // wrong-owner address is rejected: buyer has items in the cart, so the 400
  // here really is the address-ownership check (not an empty cart)
  const buyerAdd = await call(buyer, 'POST', '/api/cart', { product_id: target.product_id, quantity: 1 });
  check('second user adds to cart', buyerAdd.status === 201);
  const crossAddr = await call(buyer, 'POST', '/api/checkout', { address_id: custAddrId });
  check('checkout with another user address rejected (400)', crossAddr.status === 400);

  const buyerCo = await call(buyer, 'POST', '/api/checkout', { address_id: addrId });
  check('second user checkout works', buyerCo.status === 201 && buyerCo.body.data.order_ids.length >= 1);

  const stockAfterCheckout = (await call(cust, 'GET', '/api/products')).body.data.find((p) => p.product_id === target.product_id);
  check('stock NOT deducted at checkout (waits for vendor confirm)', stockAfterCheckout.stock_quantity === target.stock_quantity);

  console.log('--- orders ---');
  const myOrders = await call(cust, 'GET', '/api/orders');
  check('buyer sees order history with items', myOrders.status === 200 && myOrders.body.data.length >= 1 && myOrders.body.data[0].items.length >= 1);
  const newOrderId = myOrders.body.data[0].order_id;

  const vOrders = await call(vendor, 'GET', '/api/orders/vendor');
  check('vendor sees received order', vOrders.status === 200 && vOrders.body.data.some((o) => o.order_id === newOrderId));

  const st = await call(vendor, 'PUT', `/api/orders/${newOrderId}/status`, { status: 'shipped' });
  check('vendor updates order status', st.status === 200 && st.body.data.status === 'shipped');

  const stockAfterConfirm = (await call(cust, 'GET', '/api/products')).body.data.find((p) => p.product_id === target.product_id);
  check('stock deducted once vendor confirms (3 units)', stockAfterConfirm.stock_quantity === target.stock_quantity - 3);

  const mineAfterConfirm = (await call(vendor, 'GET', '/api/products/mine')).body.data.find((p) => p.product_id === target.product_id);
  check('mine shows ordered_quantity from confirmed orders (3)', mineAfterConfirm.ordered_quantity === 3);

  const dashVendor = await call(vendor, 'GET', '/api/dashboard');
  check('vendor dashboard exposes low_stock_products array', Array.isArray(dashVendor.body.data.low_stock_products));

  const badSt = await call(vendor, 'PUT', `/api/orders/${newOrderId}/status`, { status: 'nope' });
  check('invalid status rejected (400)', badSt.status === 400);

  const note = await call(vendor, 'PUT', `/api/orders/${newOrderId}/note`, { vendor_note: 'On the way!' });
  check('vendor adds note', note.status === 200);

  const orderItem = myOrders.body.data[0].items[0];
  const dUpd = await call(vendor, 'PUT', `/api/orders/${newOrderId}/items/${orderItem.order_item_id}/delivery`, {
    status: 'shipped', tracking_number: 'TRK12345', courier_name: 'BlueDart', expected_delivery_date: '2026-12-01',
  });
  check('vendor sets delivery tracking (delivery_status row)', dUpd.status === 200 && dUpd.body.data.status === 'shipped' && dUpd.body.data.tracking_number === 'TRK12345');

  const dBad = await call(vendor, 'PUT', `/api/orders/${newOrderId}/items/${orderItem.order_item_id}/delivery`, { status: 'bogus' });
  check('invalid delivery status rejected (400)', dBad.status === 400);

  const buyerOrders = await call(cust, 'GET', '/api/orders');
  const trackedItem = buyerOrders.body.data.find((o) => o.order_id === newOrderId)?.items.find((i) => i.order_item_id === orderItem.order_item_id);
  check('buyer sees delivery record on track order', trackedItem?.delivery_status === 'shipped' && trackedItem?.tracking_number === 'TRK12345' && trackedItem?.courier_name === 'BlueDart');

  console.log('--- vendor cancellation shows on buyer track order ---');
  const beforeCancel = (await call(cust, 'GET', '/api/orders')).body.data.find((o) => o.order_id === newOrderId);
  check('order not cancelled before the test', beforeCancel.status === 'shipped');
  const custCan = await call(cust, 'PUT', `/api/orders/${newOrderId}/cancel`);
  check('buyer cannot cancel (403/404)', custCan.status === 403 || custCan.status === 404);
  const vendorCan = await call(vendor, 'PUT', `/api/orders/${newOrderId}/cancel`, { reason: 'Item out of stock' });
  check('vendor cancels order', vendorCan.status === 200 && vendorCan.body.data.status === 'cancelled' && vendorCan.body.data.items_cancelled >= 1);
  const stockAfterCancel = (await call(cust, 'GET', '/api/products')).body.data.find((p) => p.product_id === target.product_id);
  check('stock restored after vendor cancel', stockAfterCancel.stock_quantity === target.stock_quantity);
  const afterCancel = (await call(cust, 'GET', '/api/orders')).body.data.find((o) => o.order_id === newOrderId);
  check('buyer sees order as cancelled', afterCancel.status === 'cancelled');
  check('every item stamped cancelled with vendor note', afterCancel.items.length >= 1 && afterCancel.items.every((i) => i.delivery_status === 'cancelled' && /Cancelled by vendor: Item out of stock/.test(i.delivery_note || '')));
  check('cancellation timestamp exposed to buyer', afterCancel.items.every((i) => Boolean(i.delivery_updated_at)));
  await call(vendor, 'PUT', `/api/orders/${newOrderId}/status`, { status: 'confirmed' });
  const reversed = (await call(cust, 'GET', '/api/orders')).body.data.find((o) => o.order_id === newOrderId);
  check('cancelling is reversible (re-confirm clears stamp)', reversed.status === 'confirmed' && reversed.items.every((i) => i.delivery_status === 'confirmed'));
  const stockAfterReconfirm = (await call(cust, 'GET', '/api/products')).body.data.find((p) => p.product_id === target.product_id);
  check('re-confirm deducts stock again', stockAfterReconfirm.stock_quantity === target.stock_quantity - 3);
  console.log('--- fuzzy categories + rich product creation ---');
  const vend2Login = await call(null, 'POST', '/api/auth/login', { email: 'freshmart.india@gmail.com', password: 'demo1234' });
  check('second vendor login (FreshMart)', vend2Login.status === 200 && vend2Login.body.data.user.is_vendor === true);
  const vendor2 = vend2Login.body.data.token;
  const catCountBefore = (await call(vendor, 'GET', '/api/categories')).body.data.length;
  const f1 = await call(vendor, 'GET', '/api/categories/fuzzy?q=' + encodeURIComponent('fruits and vegetables'));
  const fruitBase = f1.body.data;
  const create1 = await call(vendor, 'POST', '/api/products', {
    product: 'Fuzzy Category Probe A', category_id: fruitBase ? fruitBase.category_id : undefined,
    new_category: fruitBase ? undefined : 'Fruits and Vegetables',
    selling_price: 10, stock_quantity: 5,
  });
  check('product created via typed category', create1.status === 201);
  const probeA = create1.body.data;
  const f2 = await call(vendor2, 'GET', '/api/categories/fuzzy?q=' + encodeURIComponent('vegitable fruits and strawberry'));
  check('fuzzy matches variant to existing category', f2.status === 200 && f2.body.data && f2.body.data.category_id === (fruitBase ? fruitBase.category_id : probeA.category_id));
  const create2 = await call(vendor2, 'POST', '/api/products', {
    product: 'Fuzzy Category Probe B', new_category: 'vegitable fruits and strawberry',
    selling_price: 12, stock_quantity: 5,
  });
  check('second vendor reuses existing category (no dup row)', create2.status === 201 && create2.body.data.category_id === probeA.category_id);
  const catCountAfter = (await call(vendor, 'GET', '/api/categories')).body.data.length;
  check('category table unchanged (variant resolved, not duplicated)', fruitBase ? catCountAfter === catCountBefore : catCountAfter === catCountBefore + 1);
  const create3 = await call(vendor, 'POST', '/api/products', {
    product: 'Fuzzy Category Probe C', new_category: 'Quantum kites',
    selling_price: 5, stock_quantity: 2,
  });
  check('genuinely new category still gets created', create3.status === 201 && create3.body.data.category_id !== probeA.category_id);

  const richForm = new FormData();
  richForm.append('product', 'Rich Create Probe');
  richForm.append('description', 'Created with images and specs in one call');
  richForm.append('new_category', 'fruits and vegetables');
  richForm.append('selling_price', '42');
  richForm.append('stock_quantity', '7');
  richForm.append('specifications', JSON.stringify([{ title: 'Origin', spec: 'Hills' }, { title: 'Grade', spec: 'A' }]));
  richForm.append('images', tinyPng('one.png'));
  richForm.append('images', tinyPng('two.png'));
  const rich = await callForm(vendor, '/api/products/create-with-assets', richForm);
  check('multipart create with images + specs (201)', rich.status === 201 && rich.body.data.images_written === 2 && rich.body.data.specifications_written === 2);
  const richId = rich.body.data.product_id;
  const richMine = (await call(vendor, 'GET', '/api/products/mine')).body.data.find((x) => x.product_id === richId);
  check('cover image stored on disk path + is_primary', richMine.images.length === 2 && richMine.images[0].is_primary === 1 && richMine.images[0].image_url.startsWith('/uploads/products/'));
  check('specification rows written', richMine.specifications.length === 2 && richMine.specifications[0].title === 'Origin' && richMine.specifications[0].spec === 'Hills');
  const richPublic = await call(cust, 'GET', `/api/products/${richId}`);
  check('images + specs visible on the product page payload', richPublic.status === 200 && richPublic.body.data.images.length === 2 && richPublic.body.data.specifications.length === 2);

  const overForm = new FormData();
  overForm.append('product', 'Six Images Probe');
  overForm.append('new_category', 'fruits and vegetables');
  overForm.append('selling_price', '1');
  overForm.append('stock_quantity', '1');
  for (let i = 0; i < 6; i++) overForm.append('images', tinyPng(`img${i}.png`));
  const over = await callForm(vendor, '/api/products/create-with-assets', overForm);
  check('6th image rejected (400) and no product left behind', over.status === 400);

  // cleanup: delete the probe products (files on disk cascade away too)
  for (const id of [probeA.product_id, create2.body.data.product_id, create3.body.data.product_id, richId]) {
    await call(vendor, 'DELETE', `/api/products/${id}`);
  }
  const goneMine = (await call(vendor, 'GET', '/api/products/mine')).body.data.find((x) => x.product_id === richId);
  check('probe products deleted (images/specs cascade)', !goneMine);
  console.log('--- subscription purchase promotes to vendor ---');
  const plans = await call(buyer, 'GET', '/api/subscriptions');
  check('plans listed', plans.status === 200 && plans.body.data.length === 4);

  const silver = plans.body.data.find((p) => p.plan === 'Silver');
  const buy = await call(buyer, 'POST', '/api/subscriptions/purchase', { subscription_id: silver.subscription_id });
  check('purchase makes user vendor', buy.status === 200 && buy.body.data.is_vendor === true && buy.body.data.plan === 'Silver');
  {
    const from = String(buy.body.data.sub_valid_from || '').slice(0, 10);
    const to = String(buy.body.data.sub_valid_to || '').slice(0, 10);
    const [fy, fm, fd] = from.split('-').map(Number);
    const last = new Date(fm === 12 ? fy + 1 : fy, fm, 0).getDate();
    const expectTo = `${fm === 12 ? fy + 1 : fy}-${String(fm + 1).padStart(2, '0')}-${String(Math.min(fd, last)).padStart(2, '0')}`;
    const d0 = new Date();
    const today = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
    check('purchase starts today (subscribed day)', from === today);
    check('30-day plan runs subscribed day → same day next month', from === today && to === expectTo);
  }

  const nowVendor = await call(buyer, 'GET', '/api/products/mine');
  check('new vendor can access vendor endpoints', nowVendor.status === 200);

  // Silver limit is 10 products — new vendor has 0 → fill to limit then expect 403
  let buyerLimitHit = false;
  for (let i = 0; i < 12; i++) {
    const r = await call(buyer, 'POST', '/api/products', {
      product: `Buyer Prod ${i}`, category_id: catId, selling_price: 5, stock_quantity: 1, quantity: 1,
    });
    if (r.status === 403 && /limit/i.test(r.body.message || '')) { buyerLimitHit = true; break; }
  }
  check('new vendor blocked at Silver product limit (10)', buyerLimitHit);

  const dash = await call(buyer, 'GET', '/api/dashboard');
  check('dashboard shows vendor stats', dash.status === 200 && dash.body.data.product_count === 10 && dash.body.data.is_vendor === true);
  check('low-stock alert lists every product at/below 5 units', Array.isArray(dash.body.data.low_stock_products) && dash.body.data.low_stock_products.length === 10);

  console.log('--- logout ---');
  const lo = await call(vendor, 'POST', '/api/auth/logout');
  check('logout ends the session server-side', lo.status === 200);
  const afterLo = await call(vendor, 'GET', '/api/auth/me');
  check('token dead after logout (401)', afterLo.status === 401);
}

main().catch((e) => { console.error('Test run error:', e); process.exit(1); });
