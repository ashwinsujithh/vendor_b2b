const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('redirects an expired dashboard session to sign-in', async () => {
  const store = new Map([['token', 'expired-token']]);
  const location = { pathname: '/dashboard.html', href: '/dashboard.html' };
  const context = {
    fetch: async () => ({ status: 401, ok: false, json: async () => ({ message: 'Session expired' }) }),
    localStorage: {
      getItem: (key) => store.get(key) || null,
      removeItem: (key) => store.delete(key),
    },
    location,
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api.js'), 'utf8');
  vm.runInNewContext(`${source}\nglobalThis.apiUnderTest = API;`, context);

  await assert.rejects(context.apiUnderTest.get('/api/dashboard'), { message: 'Session expired' });
  assert.equal(store.has('token'), false, 'a 401 must clear the stored token');
  assert.equal(location.href, '/', 'a 401 on the dashboard must return the user to sign-in');
});

test('mobile interface exposes a settings route and theme variables', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'styles.css'), 'utf8');

  assert.match(appSource, /settings/);
  assert.match(appSource, /applyTheme/);
  assert.match(styles, /--accent/);
  assert.match(styles, /\[data-theme="violet"\]/);
});

test('invalid dashboard sessions return the user to sign-in instead of leaving an empty shell', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

  assert.match(appSource, /catch\s*\{\s*location\.href\s*=\s*'\/'/);
});

test('dashboard loads the route view definitions before the router', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');

  assert.match(dashboard, /src="\/js\/views\.js\?v=/);
});

test('product API supports image and specification payloads', () => {
  const productsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.js'), 'utf8');

  assert.match(productsSource, /product_image/);
  assert.match(productsSource, /product_specification/);
  assert.match(productsSource, /specifications/);
});

test('product API exposes a detail route for the Figma product-details screen', () => {
  const productsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.js'), 'utf8');
  const viewsSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views.js'), 'utf8');

  assert.match(productsSource, /router\.get\('\/:id\(\\\\d\+\)'/);
  assert.match(viewsSource, /viewProductDetail/);
});

test('checkout routes to the mobile order-confirmation screen', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const viewsSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views.js'), 'utf8');

  assert.match(appSource, /confirmation/);
  assert.match(viewsSource, /viewOrderConfirmation/);
});

test('product image and specification tables have dedicated API endpoints', () => {
  const productsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.js'), 'utf8');

  assert.match(productsSource, /\/:id\/images/);
  assert.match(productsSource, /\/:id\/specifications/);
});

test('mobile navigation follows the five-tab Figma structure', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const mobileNav = appSource.match(/function renderMobileNav\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(mobileNav, /route: 'dashboard', icon: '⌂', label: 'Home'/);
  assert.match(mobileNav, /route: 'shop', icon: '▦', label: 'Categories'/);
  assert.match(mobileNav, /route: 'cart', icon: '◫', label: 'Cart'/);
  assert.match(mobileNav, /route: 'orders', icon: '▤', label: 'Orders'/);
  assert.match(mobileNav, /route: 'profile', icon: '♙', label: 'Profile'/);
});

test('mobile header does not duplicate the cart shortcut', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
  assert.doesNotMatch(dashboard, /aria-label="Open cart"/);
});

test('mobile dashboard renders the branded storefront, search, categories, and featured products', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

  assert.match(appSource, /storefront-header/);
  assert.match(appSource, /VendorHub/);
  assert.match(appSource, /storefront-search/);
  assert.match(appSource, /storefront-categories/);
  assert.match(appSource, /storefront-section/);
  assert.match(appSource, /See All ›/);
  assert.match(appSource, /API\.get\('\/api\/products'/);
});

test('orders support shipment details and a dedicated tracking-map route without a mobile menu button', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const viewsSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'styles.css'), 'utf8');

  assert.match(appSource, /tracking/);
  assert.match(viewsSource, /viewOrderShipment/);
  assert.match(viewsSource, /viewOrderTracking/);
  assert.match(viewsSource, /Track order/);
  assert.match(styles, /#menu-btn \{ display: none !important; \}/);
});

test('profile uses the mobile account-settings layout and retains address management', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

  assert.match(appSource, /profile-mobile/);
  assert.match(appSource, /ACCOUNT SETTINGS/);
  assert.match(appSource, /Manage Addresses/);
  assert.match(appSource, /Order History/);
  assert.match(appSource, /profile-edit-btn/);
});

test('profile editing opens in its own mobile screen', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert.match(appSource, /profile-edit-btn/);
  assert.match(appSource, /Edit Profile/);
  assert.match(appSource, /profile-form/);
});

test('cart renders the compact checkout with quantity controls and one total amount', () => {
  const viewsSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views.js'), 'utf8');

  assert.match(viewsSource, /cart-mobile/);
  assert.match(viewsSource, /cart-quantity/);
  assert.match(viewsSource, /Total Amount/);
  assert.match(viewsSource, /Place Order/);
});

test('categories open a category browser before the filtered product-results screen', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const viewsSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views.js'), 'utf8');

  assert.match(appSource, /shop\//);
  assert.match(viewsSource, /category-browser/);
  assert.match(viewsSource, /search-results/);
  assert.match(viewsSource, /Relevance/);
});

test('profile links to the mobile subscription plans screen', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert.match(appSource, /My Subscription/);
  assert.match(appSource, /subscription-mobile/);
  assert.match(appSource, /CURRENT ACTIVE PLAN/);
});

test('active vendors receive client management with OTP verification routes', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const clientsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'clients.js'), 'utf8');
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(appSource, /vendor\/clients/);
  assert.match(appSource, /Add, edit &amp; verify clients/);
  assert.match(clientsSource, /router\.post\('\/:pairId\/verify'/);
  assert.match(clientsSource, /OTP expires/);
  assert.match(serverSource, /api\/clients/);
});

test('delivery_status table exists with per-order-item tracking fields', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

  assert.match(schema, /CREATE TABLE IF NOT EXISTS delivery_status/);
  assert.match(schema, /tracking_number/);
  assert.match(schema, /courier_name/);
  assert.match(schema, /expected_delivery_date/);
  assert.match(schema, /UNIQUE KEY uk_delivery_status_order_item \(order_item_id\)/);
  assert.match(schema, /FOREIGN KEY \(order_item_id\) REFERENCES order_item\(order_item_id\)/);
});

test('vendor delivery endpoint supports the 10-state lifecycle with order sync', () => {
  const ordersSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'orders.js'), 'utf8');

  assert.match(ordersSource, /router\.put\('\/:id\/items\/:itemId\/delivery'/);
  for (const state of ['processing', 'packed', 'out_for_delivery', 'returned', 'failed']) {
    assert.match(ordersSource, new RegExp(`'${state}'`), `missing delivery state: ${state}`);
  }
  assert.match(ordersSource, /ON DUPLICATE KEY UPDATE/);
  assert.match(ordersSource, /shipped_at/);
  assert.match(ordersSource, /delivered_at/);
});

test('order listings join delivery records onto order items', () => {
  const ordersSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'orders.js'), 'utf8');

  assert.match(ordersSource, /LEFT JOIN delivery_status ds ON ds\.order_item_id = oi\.order_item_id/);
  assert.match(ordersSource, /ds\.status AS delivery_status/);
});

test('product images are capped at 5 in the product API', () => {
  const productsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.js'), 'utf8');

  assert.match(productsSource, /images\.length > 5/);
  assert.match(productsSource, /at most 5 images/);
  assert.doesNotMatch(productsSource, /\.slice\(0, 6\)/);
});

test('product detail renders a swipeable 5-image slider with related fields', () => {
  const viewsSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views.js'), 'utf8');

  assert.match(viewsSource, /viewProductDetail/);
  assert.match(viewsSource, /detail-slider/);
  assert.match(viewsSource, /\.slice\(0, 5\)/);
  assert.match(viewsSource, /data-prev/);
  assert.match(viewsSource, /data-next/);
  assert.match(viewsSource, /slider-dots/);
  assert.match(viewsSource, /touchstart/);
  assert.match(viewsSource, /Pack size/);
  assert.match(viewsSource, /category_name/);
});

test('buyer shipment and tracking screens surface real delivery data', () => {
  const viewsSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views.js'), 'utf8');

  assert.match(viewsSource, /out_for_delivery/);
  assert.match(viewsSource, /expected_delivery_date/);
  assert.match(viewsSource, /courier_name/);
  assert.match(viewsSource, /deliveryBadge/);
});

test('vendor orders screen offers per-item delivery editing (delivered is OTP-only)', () => {
  const viewsSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views.js'), 'utf8');

  assert.match(viewsSource, /DELIVERY_STATES = \['pending', 'confirmed', 'processing', 'packed', 'shipped', 'out_for_delivery', 'cancelled', 'returned', 'failed'\]/);
  assert.match(viewsSource, /items\/\$\{it\.order_item_id\}\/delivery/);
});

test('delivered/completed are OTP-only: rejected on manual status routes, set by verify-delivery', () => {
  const ordersSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'orders.js'), 'utf8');

  // The per-item delivery route refuses 'delivered'.
  assert.match(ordersSource, /status === 'delivered'\) \{/, 'per-item delivery route must reject delivered');
  // The order-status route uses a vendor-safe list without delivered/completed.
  assert.match(ordersSource, /VENDOR_ORDER_STATUSES = \['pending', 'confirmed', 'shipped', 'out_for_delivery', 'cancelled'\]/);
  assert.match(ordersSource, /!VENDOR_ORDER_STATUSES\.includes\(status\)/);
  // The auto-sync can never write 'delivered' onto the order either.
  assert.doesNotMatch(ordersSource, /orderStatus = STATUSES\.includes/);
});

test('status chips cover the extended delivery states', () => {
  const uiSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ui.js'), 'utf8');

  for (const state of ['processing', 'packed', 'out_for_delivery', 'returned', 'failed']) {
    assert.match(uiSource, new RegExp(`${state}:`), `statusChip missing state: ${state}`);
  }
});

test('registration is removed and login-only auth is enforced', () => {
  const authSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.js'), 'utf8');
  const loginPage = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const authJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'auth.js'), 'utf8');

  assert.doesNotMatch(authSource, /router\.post\('\/register'/, 'register endpoint must be removed');
  assert.match(authSource, /router\.post\('\/logout'/);
  assert.doesNotMatch(loginPage, /register-form|tab-register/);
  assert.match(authJs, /\/api\/auth\/login/);
  assert.doesNotMatch(authJs, /\/api\/auth\/register/);
});

test('user.is_active is a boolean with session_token for single-session enforcement', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const authSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'middleware', 'auth.js'), 'utf8');
  const clientsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'clients.js'), 'utf8');

  assert.match(schema, /is_active TINYINT\(1\) NOT NULL DEFAULT 0/);
  assert.match(schema, /session_token CHAR\(64\) NULL/);
  // login creates a session, every request verifies it, mismatch = terminated
  assert.match(authSource, /createSession/);
  assert.match(authSource, /sid: user\.session_token/);
  assert.match(authSource, /payload\.sid !== user\.session_token/);
  assert.match(authSource, /another device/i);
  assert.match(authSource, /Number\(u\.is_active\) === 1 &&/);
  // clients flow uses boolean status (0 pending → 1 verified); a staged invite
  // carries only the mobile number until the OTP is verified
  
  assert.match(clientsSource, /staged_reg_phone/);
  assert.doesNotMatch(clientsSource, /staged_name|staged_email|staged_alt_phone/);
  // vendor_client pairs drive the client relationship
  assert.match(schema, /CREATE TABLE IF NOT EXISTS vendor_client/);
  assert.match(schema, /staged_reg_phone VARCHAR\(20\) NULL/);
});

test('products are visible only to the selling vendor\'s clients', () => {
  const productsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.js'), 'utf8');
  const cartSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'cart.js'), 'utf8');
  const checkoutSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'checkout.js'), 'utf8');

  assert.match(productsSource, /clientVisibleSql/);
  assert.match(productsSource, /p\.vendor_id IN \(/);
  assert.match(productsSource, /req\.user\?\.vendor_ids/);
  assert.match(cartSource, /req\.user\.vendor_ids/);
  assert.match(checkoutSource, /req\.user\.vendor_ids/);
});

test('client invites are mobile-first and reveal existence only at verify', () => {
  const clientsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'clients.js'), 'utf8');

  // staged invite keyed by mobile — no account creation on add
  assert.match(clientsSource, /staged_reg_phone/);
  assert.doesNotMatch(clientsSource, /INSERT INTO user[\s\S]{0,200}router\.get\('\/'/);
  // verify resolves existence: link known accounts, create unknown ones
  assert.match(clientsSource, /existing_account/);
  assert.match(clientsSource, /SELECT user_id, is_active FROM user WHERE reg_phone = \?/);
  // post-verify address capture for new clients
  assert.match(clientsSource, /router\.post\('\/:pairId\/address'/);
  assert.match(clientsSource, /address_pending/);
});
