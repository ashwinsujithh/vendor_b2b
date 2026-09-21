/* StorePanel app: router, sidebar, dashboard, profile, plans */

let USER = null;
let CATEGORY_CACHE = null;

function applyTheme(theme = localStorage.getItem('theme') || 'green') {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('theme', theme);
}

async function categories() {
  if (!CATEGORY_CACHE) CATEGORY_CACHE = await API.get('/api/categories');
  return CATEGORY_CACHE;
}
function invalidateCategories() { CATEGORY_CACHE = null; }

/* ---------------- sidebar & chrome ---------------- */

function navItems() {
  const items = [
    { section: 'Shopping' },
    { route: 'dashboard', icon: '🏠', label: 'Dashboard' },
    { route: 'shop', icon: '🛍️', label: 'Shop' },
    { route: 'cart', icon: '🛒', label: 'Cart' },
    { route: 'orders', icon: '📦', label: 'My Orders' },
  ];
  if (USER.is_vendor) {
    items.push(
      { section: 'Vendor' },
      { route: 'vendor/products', icon: '🏷️', label: 'My Products' },
      { route: 'vendor/clients', icon: '🤝', label: 'Clients' },
      { route: 'vendor/categories', icon: '🗂️', label: 'Categories' },
      { route: 'vendor/orders', icon: '📥', label: 'Vendor Orders' }
    );
  }
  items.push(
    { section: 'Account' },
    { route: 'plans', icon: '⭐', label: 'Subscription Plans' },
    { route: 'profile', icon: '👤', label: 'My Profile' },
    { route: 'settings', icon: '⚙️', label: 'Settings' }
  );
  return items;
}

function renderMobileNav() {
  const nav = document.getElementById('mobile-nav');
  // The mobile app follows the shared customer journey for every account.
  // Vendor management remains available from the menu on larger layouts.
  const items = [
    { route: 'dashboard', icon: '⌂', label: 'Home' },
    { route: 'shop', icon: '▦', label: 'Categories' },
    { route: 'cart', icon: '◫', label: 'Cart' },
    { route: 'orders', icon: '▤', label: 'Orders' },
    { route: 'profile', icon: '♙', label: 'Profile' },
  ];
  // Vendor parity: swap Categories for My Products so vendor tools are
  // reachable from the phone bottom bar (their topbar is hidden on mobile).
  if (USER.is_vendor) items[1] = { route: 'vendor/products', icon: '▦', label: 'Products' };
  nav.innerHTML = items.map((item) => `<a class="mobile-nav-item" data-route="${item.route}" href="#/${item.route}"><span>${item.icon}</span><small>${item.label}</small></a>`).join('');
}

function renderSidebar() {
  const nav = document.getElementById('side-nav');
  nav.innerHTML = navItems()
    .map((it) =>
      it.section
        ? `<div class="nav-section">${esc(it.section)}</div>`
        : `<a class="nav-item" data-route="${it.route}" href="#/${it.route}"><span>${it.icon}</span> ${esc(it.label)}</a>`
    )
    .join('');

  document.getElementById('side-user').innerHTML = `
    <div class="who">${esc(USER.name)}</div>
    <div class="muted">${esc(USER.email)}</div>
    <span class="chip ${USER.is_vendor ? '' : 'green'}" style="margin-top:6px">${USER.is_vendor ? 'Vendor · ' + esc(USER.plan) : 'Customer'}</span>`;
}

function updatePlanChip() {
  const chip = document.getElementById('plan-chip');
  if (USER.is_vendor) {
    chip.textContent = `⭐ ${USER.plan}`;
    chip.className = 'chip';
  } else {
    chip.textContent = 'Customer';
    chip.className = 'chip green';
  }
}

async function viewAddresses(view) {
  const openModal = (title, address) => {
    const root = view.querySelector('#address-modal-root');
    root.innerHTML = `<div class="modal-overlay" id="address-overlay"><div class="modal-card" role="dialog" aria-modal="true"><div class="modal-head"><h4>${esc(title)}</h4><button type="button" class="modal-close" id="address-modal-x" aria-label="Close">×</button></div><form id="address-form"><label>Address line 1<input name="address_line_1" required></label><label>Address line 2<input name="address_line_2"></label><div class="grid grid-2"><label>City<input name="city" required></label><label>State<input name="state" required></label></div><div class="grid grid-2"><label>Pincode<input name="pincode" required></label><label>Country<input name="country" value="India"></label></div><div class="modal-actions"><button class="btn btn-primary" type="submit">Save Address</button><button class="btn btn-ghost" type="button" id="address-modal-cancel">Cancel</button></div></form></div></div>`;
    const overlay = root.querySelector('#address-overlay');
    const form = root.querySelector('#address-form');
    if (address) Object.keys(address).forEach((key) => { if (form[key]) form[key].value = address[key] || ''; });
    const close = () => { document.removeEventListener('keydown', onKey); root.innerHTML = ''; };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    root.querySelector('#address-modal-x').onclick = close;
    root.querySelector('#address-modal-cancel').onclick = close;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(form).entries());
      try {
        if (address) await API.put('/api/addresses/' + address.address_id, body);
        else await API.post('/api/addresses', body);
        close();
        toast(address ? 'Address updated.' : 'Address added.');
        render();
      } catch (err) {
        toast(err.message, true);
      }
    };
    form.address_line_1.focus();
  };
  const render = async () => {
    const addresses = await API.get('/api/addresses');
    view.innerHTML = `<section class="addresses-mobile"><header><a href="#/profile">‹</a><h3>My Addresses</h3></header><div class="addresses-list">${addresses.length ? addresses.map((address, index) => `<article class="address-mobile-card ${index === 0 ? 'default' : ''}"><small>${index === 0 ? 'Default Delivery' : 'Set as Default'}</small><b>${esc(address.address_line_1)}</b><p>${esc(address.address_line_2 || '')}<br>${esc(address.city)}, ${esc(address.state)} ${esc(address.pincode)}</p><div><button data-edit="${address.address_id}" aria-label="Edit address">✎</button><button data-delete="${address.address_id}" aria-label="Delete address">⌫</button></div></article>`).join('') : '<p class="empty">No addresses saved yet.</p>'}</div><button id="address-new" class="btn btn-primary">＋ Add New Address</button><div id="address-modal-root"></div></section>`;
    view.querySelector('#address-new').onclick = () => openModal('Add New Address', null);
    view.querySelectorAll('[data-edit]').forEach((button) => button.onclick = () => {
      const address = addresses.find((item) => item.address_id === Number(button.dataset.edit));
      openModal('Edit Address', address);
    });
    view.querySelectorAll('[data-delete]').forEach((button) => button.onclick = async () => {
      if (!confirmDialog('Delete this address?')) return;
      try {
        await API.del('/api/addresses/' + button.dataset.delete);
        toast('Address deleted.');
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });
  };
  await render();
}

async function refreshCartBadge() {
  try {
    const cart = await API.get('/api/cart');
    const badge = document.getElementById('cart-badge');
    if (badge) badge.textContent = cart.items.length;
  } catch { /* ignore */ }
}

/* ---------------- router ---------------- */

const routes = {
  dashboard: { title: 'Dashboard', render: viewDashboard },
  profile: { title: 'My Profile', render: viewProfile },
  addresses: { title: 'My Addresses', render: viewAddresses },
  plans: { title: 'Subscription Plans', render: viewPlans },
  shop: { title: 'Shop', render: viewShop },
  cart: { title: 'Cart', render: viewCart },
  orders: { title: 'My Orders', render: viewOrders },
  order: { title: 'Shipment Status', render: viewOrderShipment },
  'order-requests': { title: 'My Orders', render: viewOrders },
  tracking: { title: 'Track Order', render: viewOrderTracking },
  product: { title: 'Product Details', render: viewProductDetail },
  confirmation: { title: 'Order Confirmed', render: viewOrderConfirmation },
  'vendor/products': { title: 'My Products', vendorOnly: true, render: viewVendorProducts },
  'product-new': { title: 'Add Product', vendorOnly: true, render: viewProductAdd },
  'product-edit': { title: 'Edit Product', vendorOnly: true, render: viewProductEdit },
  'vendor/clients': { title: 'Clients', vendorOnly: true, render: viewVendorClients },
  'vendor/categories': { title: 'Categories', vendorOnly: true, render: viewVendorCategories },
  'vendor/orders': { title: 'Vendor Orders', vendorOnly: true, render: viewVendorOrders },
  settings: { title: 'Settings', render: viewSettings },
};

function currentRouteKey() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('product/')) return 'product';
  if (h.startsWith('product-edit/')) return 'product-edit';
  if (h.startsWith('shop/')) return 'shop';
  if (h.startsWith('confirmation/')) return 'confirmation';
  if (h.startsWith('order-requests')) return 'order-requests';
  if (h.startsWith('order/')) return 'order';
  if (h.startsWith('tracking/')) return 'tracking';
  return routes[h] ? h : 'dashboard';
}

async function route() {
  const key = currentRouteKey();
  const r = routes[key];
  if (r.vendorOnly && !USER.is_vendor) {
    toast('Buy a subscription plan to unlock vendor tools.', true);
    location.hash = '#/plans';
    return;
  }
  document.getElementById('page-title').textContent = r.title;
  document.body.dataset.route = key;
  document.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
  document.querySelectorAll('.mobile-nav-item').forEach((a) => a.classList.toggle('active', key === 'vendor/products' ? a.dataset.route === 'vendor/products' : a.dataset.route === key));
  const view = document.getElementById('view');
  view.innerHTML = '<div class="empty">Loading…</div>';
  try {
    await r.render(view);
  } catch (err) {
    view.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function viewSettings(view) {
  const activeTheme = document.documentElement.dataset.theme || 'green';
  view.innerHTML = `
    <div class="mobile-page-title"><p class="eyebrow">PREFERENCES</p><h3>Personalise your workspace</h3><p>Choose an accent colour for actions, highlights and navigation.</p></div>
    <section class="card settings-card">
      <h3>Colour theme</h3>
      <div class="theme-options">
        <button class="theme-option ${activeTheme === 'green' ? 'selected' : ''}" data-theme="green"><span class="theme-swatch green-swatch"></span><span><strong>Fresh green</strong><small>Focused and clear</small></span><b>✓</b></button>
        <button class="theme-option ${activeTheme === 'violet' ? 'selected' : ''}" data-theme="violet"><span class="theme-swatch violet-swatch"></span><span><strong>Violet</strong><small>Bold and expressive</small></span><b>✓</b></button>
      </div>
    </section>
    <section class="card settings-card"><h3>Account</h3><a class="settings-link" href="#/profile">Profile <span>›</span></a><a class="settings-link" href="#/plans">Subscription <span>›</span></a></section>`;
  view.querySelectorAll('[data-theme]').forEach((button) => {
    button.onclick = () => { applyTheme(button.dataset.theme); viewSettings(view); };
  });
}

/* ---------------- dashboard ---------------- */

async function viewDashboard(view) {
  const [allProducts, cats] = await Promise.all([API.get('/api/products'), categories()]);
  let activeCategory = '';
  view.innerHTML = `<section class="storefront" aria-label="VendorHub catalogue">
    <header class="storefront-header"><a class="storefront-brand" href="#/dashboard" aria-label="VendorHub home"><span class="storefront-logo">▣</span><strong>VendorHub</strong></a><div class="storefront-actions"><button class="storefront-icon" type="button" aria-label="Notifications">♧</button><a class="storefront-avatar" href="#/profile" aria-label="Open profile">${esc(USER.name.trim().charAt(0).toUpperCase() || 'U')}</a></div></header>
    <label class="storefront-search"><span aria-hidden="true">⌕</span><input id="storefront-search" type="search" placeholder="Search your vendor's products..." aria-label="Search products" /><button type="button" id="storefront-filter" aria-label="Clear filters">☷</button></label>
    <section class="storefront-section"><h3>Categories</h3><div class="storefront-categories" id="storefront-categories"><button class="category-chip active" type="button" data-category="">◉ All</button>${cats.map((cat) => `<button class="category-chip" type="button" data-category="${cat.category_id}">${esc(cat.category)}</button>`).join('')}</div></section>
    <div id="storefront-products"></div>
  </section>`;

  const search = view.querySelector('#storefront-search');
  const productsHost = view.querySelector('#storefront-products');
  const productCard = (product) => {
    const image = product.images?.[0]?.image_url;
    return `<a class="storefront-product" href="#/product/${product.product_id}">${image ? `<img src="${esc(image)}" alt="${esc(product.product)}" />` : `<div class="storefront-product-placeholder" aria-hidden="true">${esc(product.product).slice(0, 1).toUpperCase()}</div>`}<span class="storefront-vendor">${esc(product.vendor_name || product.category_name || 'VendorHub')}</span><b>${esc(product.product)}</b><span class="storefront-price">${money(product.selling_price)} <em class="${product.stock_quantity > 0 ? 'in-stock' : 'out-stock'}">${product.stock_quantity > 0 ? product.stock_quantity + ' in stock' : 'Out of Stock'}</em></span></a>`;
  };
  const matches = (product, query) => {
    const searchable = `${product.product} ${product.category_name || ''} ${product.vendor_name || ''}`.toLowerCase();
    return !query || searchable.includes(query);
  };
  // Home shows EVERY product, grouped under its category section.
  // Chips narrow the view to one category; searching collapses into a results section.
  const renderProducts = () => {
    const query = search.value.trim().toLowerCase();
    // Selling is vendor → their own clients: if no products are visible, this
    // account isn't a client of any vendor (yet) or their vendor has no stock.
    if (!allProducts.length && !query) {
      productsHost.innerHTML = '<section class="storefront-section"><p class="storefront-empty">No products to show yet. You will see your vendor\'s products here once they add you as their client.</p></section>';
      return;
    }
    let html = '';
    if (query) {
      const results = allProducts.filter((p) => matches(p, query));
      html = `<section class="storefront-section"><div class="storefront-section-title"><h3>Results (${results.length})</h3></div>${results.length ? `<div class="storefront-products">${results.map(productCard).join('')}</div>` : '<p class="storefront-empty">No matching products found.</p>'}</section>`;
    } else {
      const visibleCats = activeCategory ? cats.filter((c) => String(c.category_id) === activeCategory) : cats;
      html = visibleCats.map((cat) => {
        const inCat = allProducts.filter((p) => String(p.category_id) === String(cat.category_id));
        return `<section class="storefront-section"><div class="storefront-section-title"><h3>${esc(cat.category)} <small class="muted">(${inCat.length})</small></h3><a href="#/shop/${cat.category_id}">See All ›</a></div>${inCat.length ? `<div class="storefront-products product-strip">${inCat.map(productCard).join('')}</div>` : '<p class="storefront-empty">No products in this category yet.</p>'}</section>`;
      }).join('');
    }
    productsHost.innerHTML = html || '<p class="storefront-empty">No products found.</p>';
  };
  search.addEventListener('input', renderProducts);
  view.querySelector('#storefront-filter').onclick = () => { search.value = ''; activeCategory = ''; view.querySelectorAll('.category-chip').forEach((chip) => chip.classList.toggle('active', !chip.dataset.category)); renderProducts(); };
  view.querySelectorAll('.category-chip').forEach((chip) => { chip.onclick = () => { activeCategory = chip.dataset.category; view.querySelectorAll('.category-chip').forEach((item) => item.classList.toggle('active', item === chip)); renderProducts(); }; });
  renderProducts();
}

/* ---------------- profile ---------------- */

async function viewProfile(view) {
  const vendorWorkspace = USER.is_vendor ? `
      <p class="profile-section-label">VENDOR WORKSPACE</p>
      <div class="profile-settings vendor-profile-settings">
        <a href="#/plans" class="profile-setting"><span>★</span><i><b>Subscription</b><small>${esc(USER.plan)} plan · manage or renew</small></i><em>›</em></a>
        <a href="#/vendor/products" class="profile-setting"><span>▤</span><i><b>Products</b><small>Add, view &amp; edit catalogue</small></i><em>›</em></a>
        <a href="#/vendor/clients" class="profile-setting"><span>♧</span><i><b>Clients</b><small>Add, edit &amp; verify clients</small></i><em>›</em></a>
      </div>` : '';
  view.innerHTML = `
    <section class="profile-mobile">
      <div class="profile-summary"><span class="profile-avatar">${esc(USER.name.trim().charAt(0).toUpperCase() || 'U')}</span><h3>${esc(USER.name)}</h3><p>${esc(USER.email)}</p><button id="profile-edit-btn" class="profile-edit">Edit Profile</button></div>
      <p class="profile-section-label">ACCOUNT SETTINGS</p>
      <div class="profile-settings">
        <a href="#/addresses" class="profile-setting"><span>⌖</span><i><b>Manage Addresses</b><small id="profile-address-preview">Add a delivery address</small></i><em>›</em></a>
        ${USER.is_vendor ? '' : '<a href="#/plans" class="profile-setting"><span>★</span><i><b>My Subscription</b><small>Choose a plan</small></i><em>›</em></a>'}
        <button id="payment-method-btn" class="profile-setting"><span>▣</span><i><b>Payment Methods</b><small>Secure payment options</small></i><em>›</em></button>
        <a class="profile-setting" href="#/orders"><span>▤</span><i><b>Order History</b><small>View all previous invoices</small></i><em>›</em></a>
      </div>
      ${vendorWorkspace}
      <button id="profile-logout-btn" class="profile-logout"><span>◔</span> Log Out</button>
      <form id="profile-form" class="profile-editor hidden">
        <label>Full name <input name="name" required value="${esc(USER.name)}" /></label>
        <label>Registered phone <input value="${esc(USER.reg_phone)}" disabled /></label>
        <label>Alternate phone <input name="alt_phone" value="${esc(USER.alt_phone || '')}" /></label>
        <label>Email <input type="email" name="email" required value="${esc(USER.email)}" /></label>
        <button class="btn btn-primary mt" type="submit">Save changes</button>
      </form>
      <div id="profile-sub" class="hidden"></div>
      <section id="profile-address-panel" class="profile-address-panel hidden"><div class="page-head"><h3>Manage Addresses</h3><button id="addr-panel-close" class="btn btn-ghost btn-sm" type="button">Close</button></div><div id="addr-list" class="addr-grid"></div>
      <form id="addr-form" class="hidden mt" style="max-width:520px">
        <label>Address line 1 <input name="address_line_1" required /></label>
        <label>Address line 2 <input name="address_line_2" /></label>
        <div class="grid grid-2">
          <label>City <input name="city" required /></label>
          <label>State <input name="state" required /></label>
        </div>
        <div class="grid grid-2">
          <label>Country <input name="country" value="India" /></label>
          <label>Pincode <input name="pincode" required /></label>
        </div>
        <div style="display:flex;gap:8px" class="mt">
          <button class="btn btn-primary" type="submit">Save address</button>
          <button class="btn btn-ghost" type="button" id="addr-cancel">Cancel</button>
        </div>
      </form></section>
    </section>`;

  // subscription card
  const subEl = view.querySelector('#profile-sub');
  if (USER.is_vendor) {
    const daysLeft = Math.max(0, Math.ceil((new Date(`${USER.sub_valid_to}T00:00:00`) - new Date()) / 86400000));
    subEl.innerHTML = `
      <div class="card">
        <h3>Subscription</h3>
        <div class="kv">
          <div class="k">Plan</div><div><span class="chip">${esc(USER.plan)}</span></div>
          <div class="k">Valid from</div><div>${fmtDate(USER.sub_valid_from)}</div>
          <div class="k">Valid till</div><div>${fmtDate(USER.sub_valid_to)} <span class="muted">(${daysLeft} days left)</span></div>
        </div>
        <div class="mt">
          <div class="muted" style="font-size:13px;margin-bottom:4px">Products — ${progressBar(USER.number_of_products, USER.number_of_products)}</div>
          <div class="muted" style="font-size:13px">Client slots — ${progressBar(USER.number_of_clients, USER.number_of_clients)}</div>
        </div>
        <a class="btn btn-outline btn-sm mt" href="#/plans">Upgrade / renew</a>
      </div>`;
  } else {
    subEl.innerHTML = `
      <div class="card">
        <h3>Subscription</h3>
        <p class="muted">No active plan — you are a normal customer.</p>
        <p class="muted" style="margin-top:6px">Purchasing any plan instantly makes you a vendor with product &amp; client limits.</p>
        <a class="btn btn-primary btn-sm mt" href="#/plans">See plans</a>
      </div>`;
  }

  // profile form submit
  view.querySelector('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      USER = await API.put('/api/profile', {
        name: fd.get('name'),
        alt_phone: fd.get('alt_phone') || undefined,
        email: fd.get('email'),
      });
      renderSidebar();
      updatePlanChip();
      toast('Profile updated.');
    } catch (err) {
      toast(err.message, true);
    }
  });
  view.querySelector('#profile-edit-btn').onclick = () => view.querySelector('#profile-form').classList.toggle('hidden');
  view.querySelector('#payment-method-btn').onclick = () => toast('Payment methods will be available soon.');
  view.querySelector('#profile-logout-btn').onclick = () => document.getElementById('logout-btn').click();

  // addresses
  let editingId = null;
  const listEl = view.querySelector('#addr-list');
  const form = view.querySelector('#addr-form');

  async function renderAddresses() {
    const addrs = await API.get('/api/addresses');
    listEl.innerHTML = addrs.length
      ? addrs
          .map(
            (a) => `
        <div class="addr-card">
          <div>${esc(a.address_line_1)}${a.address_line_2 ? ', ' + esc(a.address_line_2) : ''}</div>
          <div>${esc(a.city)}, ${esc(a.state)} ${esc(a.pincode)}</div>
          <div class="muted">${esc(a.country)}</div>
          <div class="addr-actions">
            <button class="btn btn-ghost btn-sm" data-edit="${a.address_id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-del="${a.address_id}">Delete</button>
          </div>
        </div>`
          )
          .join('')
      : '<div class="empty">No addresses saved yet.</div>';
    view.querySelector('#profile-address-preview').textContent = addrs.length ? `${addrs[0].address_line_1}, ${addrs[0].city}` : 'Add a delivery address';

    listEl.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => {
        const a = addrs.find((x) => x.address_id === Number(b.dataset.edit));
        editingId = a.address_id;
        form.classList.remove('hidden');
        form.address_line_1.value = a.address_line_1;
        form.address_line_2.value = a.address_line_2 || '';
        form.city.value = a.city;
        form.state.value = a.state;
        form.country.value = a.country;
        form.pincode.value = a.pincode;
        form.scrollIntoView({ behavior: 'smooth' });
      };
    });
    listEl.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!confirmDialog('Delete this address?')) return;
        try {
          await API.del('/api/addresses/' + b.dataset.del);
          toast('Address deleted.');
          renderAddresses();
        } catch (err) {
          toast(err.message, true);
        }
      };
    });
  }
  renderAddresses();

  view.querySelector('#addr-panel-close').onclick = () => view.querySelector('#profile-address-panel').classList.add('hidden');
  view.querySelector('#addr-cancel').onclick = () => form.classList.add('hidden');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = Object.fromEntries(fd.entries());
    try {
      if (editingId) await API.put('/api/addresses/' + editingId, body);
      else await API.post('/api/addresses', body);
      toast('Address saved.');
      form.classList.add('hidden');
      renderAddresses();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

/* ---------------- vendor clients ---------------- */

async function viewVendorClients(view) {
  let clients = await API.get('/api/clients');
  let adding = false;
  let editingPairId = null;
  let editingPair = null;
  let otpPairId = null;
  let otpDemo = '';
  let otpNotice = '';
  let detailsPair = null;

  const render = () => {
    const otpPair = clients.find((client) => client.pair_id === otpPairId);
    const verifiedCount = clients.filter((c) => Number(c.status) === 1).length;
    view.innerHTML = `<section class="clients-mobile">
      <header><a href="#/profile" aria-label="Back to profile">‹</a><h3>My Clients</h3><button id="client-new" type="button">＋</button></header>
      <div class="client-limit"><span>CLIENTS</span><b>${verifiedCount} of ${USER.number_of_clients}</b><i><em style="width:${Math.min(100, (verifiedCount / Math.max(1, USER.number_of_clients)) * 100)}%"></em></i></div>
      <div class="client-list">${clients.length ? clients.map((client) => `<article class="client-card"><span class="client-avatar">${esc((client.name || '?').slice(0, 1).toUpperCase())}</span><div><b>${esc(client.name || 'Pending verification')}</b><small>${client.email ? esc(client.email) + ' · ' : ''}${esc(client.reg_phone || '')}</small><em class="client-status ${Number(client.status) === 1 ? 'verified' : ''}">${Number(client.status) === 1 ? 'Verified' : 'Verification needed'}</em></div><div class="client-actions"><button data-client-edit="${client.pair_id}" aria-label="Edit ${esc(client.name || 'client')}">✎</button>${Number(client.status) === 1 ? '' : `<button data-client-verify="${client.pair_id}">Verify</button>`}</div></article>`).join('') : '<div class="catalog-empty"><p>No clients yet</p><small>Add your first client to start taking orders from them.</small><button id="clients-empty-add" class="btn btn-primary" type="button">＋ Add client</button></div>'}</div>
      ${adding ? `<form id="client-form" class="client-form"><h4>Add Client</h4><label>Mobile number<input name="reg_phone" inputmode="tel" pattern="\\d{10}" maxlength="10" placeholder="10-digit mobile" required autofocus value=""></label><p class="muted" style="font-size:11px;margin:4px 0 0">We'll verify this number with an OTP. Name and other details are asked after verification.</p><button class="btn btn-primary" type="submit">Send OTP</button><button class="btn btn-ghost" type="button" id="client-cancel">Cancel</button></form>` : ''}
      ${editingPairId ? `<form id="client-edit-form" class="client-form"><h4>Edit Client</h4><label>Client name<input name="name" required value="${esc(editingPair?.name || '')}"></label><label>Email <span class="muted">(optional)</span><input name="email" type="email" value="${esc(editingPair?.email || '')}"></label><label>Mobile number<input name="reg_phone" inputmode="tel" pattern="\\d{10}" maxlength="10" required value="${esc(editingPair?.reg_phone || '')}"></label><label>Alternate phone <span class="muted">(optional)</span><input name="alt_phone" inputmode="tel" value="${esc(editingPair?.alt_phone || '')}"></label><button class="btn btn-primary" type="submit">Save changes</button><button class="btn btn-ghost" type="button" id="client-edit-cancel">Cancel</button></form>` : ''}
      ${otpPair ? `<section class="otp-panel"><div><b>Verify ${esc(otpPair.reg_phone)}</b><small>Dummy OTP for now (no SMS yet) — enter the code below</small></div>${otpNotice ? `<p class="otp-notice">${esc(otpNotice)}</p>` : ''}<p class="demo-otp">Demo code: <strong>${otpDemo || '123456'}</strong></p><form id="otp-form"><input name="code" inputmode="numeric" maxlength="6" pattern="\\d{6}" placeholder="6-digit OTP" required><button class="btn btn-primary" type="submit">Verify</button></form><button id="resend-otp" type="button">Resend code</button></section>` : ''}
      ${detailsPair ? `<form id="client-details-form" class="client-form"><h4>Client details</h4><p class="muted" style="font-size:11px;margin:0 0 6px">${esc(detailsPair.reg_phone)} is verified — add their name and delivery address to finish.</p><label>Client name<input name="name" required value=""></label><label>Email <span class="muted">(optional)</span><input name="email" type="email" value=""></label><label>Alternate phone <span class="muted">(optional)</span><input name="alt_phone" inputmode="tel" value=""></label><label>Address line 1<input name="address_line_1" required></label><label>Address line 2<input name="address_line_2"></label><div class="grid grid-2"><label>City<input name="city" required></label><label>State<input name="state" required></label></div><label>Pincode<input name="pincode" inputmode="numeric" maxlength="6" required></label><button class="btn btn-primary" type="submit">Save client</button><button class="btn btn-ghost" type="button" id="client-details-skip">Skip for now</button></form>` : ''}
    </section>`;

    view.querySelector('#client-new').onclick = () => { adding = true; editingPairId = null; editingPair = null; otpPairId = null; otpNotice = ''; detailsPair = null; render(); };
    view.querySelector('#clients-empty-add')?.addEventListener('click', () => view.querySelector('#client-new').click());
    view.querySelectorAll('[data-client-edit]').forEach((button) => button.onclick = () => {
      const client = clients.find((item) => item.pair_id === Number(button.dataset.clientEdit));
      editingPairId = client.pair_id; editingPair = client; adding = false; otpPairId = null; detailsPair = null; render();
    });
    view.querySelectorAll('[data-client-verify]').forEach((button) => button.onclick = () => {
      otpPairId = Number(button.dataset.clientVerify); otpDemo = ''; otpNotice = ''; adding = false; editingPairId = null; detailsPair = null; render();
    });
    const addForm = view.querySelector('#client-form');
    if (addForm) {
      addForm.onsubmit = async (event) => {
        event.preventDefault();
        const body = Object.fromEntries(new FormData(addForm).entries());
        try {
          const created = await API.post('/api/clients', body);
          otpPairId = created.pair_id;
          otpDemo = created.demo_otp || '';
          otpNotice = '';
          adding = false;
          clients = await API.get('/api/clients');
          render();
        } catch (err) { toast(err.message, true); }
      };
      view.querySelector('#client-cancel').onclick = () => { adding = false; render(); };
    }
    const editForm = view.querySelector('#client-edit-form');
    if (editForm) {
      editForm.onsubmit = async (event) => {
        event.preventDefault();
        const body = Object.fromEntries(new FormData(editForm).entries());
        try {
          await API.put('/api/clients/' + editingPairId, body);
          clients = await API.get('/api/clients');
          editingPairId = null; editingPair = null;
          toast('Client saved.');
          render();
        } catch (err) { toast(err.message, true); }
      };
      view.querySelector('#client-edit-cancel').onclick = () => { editingPairId = null; editingPair = null; render(); };
    }
    const detailsForm = view.querySelector('#client-details-form');
    if (detailsForm) {
      detailsForm.onsubmit = async (event) => {
        event.preventDefault();
        const body = Object.fromEntries(new FormData(detailsForm).entries());
        const { address_line_1, address_line_2, city, state, country, pincode, ...details } = body;
        try {
          await API.put('/api/clients/' + detailsPair.pair_id, details);
          await API.post('/api/clients/' + detailsPair.pair_id + '/address', { address_line_1, address_line_2, city, state, country, pincode });
          toast('Client details saved.');
          detailsPair = null;
          render();
        } catch (err) { toast(err.message, true); }
      };
      view.querySelector('#client-details-skip').onclick = () => { detailsPair = null; render(); };
    }
    if (!otpPair) return;
    view.querySelector('#resend-otp').onclick = async () => {
      try {
        const response = await API.post('/api/clients/' + otpPairId + '/send-otp');
        otpDemo = response.demo_otp || '';
        toast('A new OTP was created.');
        render();
      } catch (err) { toast(err.message, true); }
    };
    view.querySelector('#otp-form').onsubmit = async (event) => {
      event.preventDefault();
      try {
        const result = await API.post('/api/clients/' + otpPairId + '/verify', { code: new FormData(event.target).get('code') });
        clients = await API.get('/api/clients');
        otpPairId = null; otpDemo = '';
        if (result.existing_account) {
          toast('Existing user added to your client list.');
        } else if (result.needs_details) {
          // Brand-new account: collect name/email/address only AFTER verification.
          toast('Number verified — now add the client details.');
          detailsPair = clients.find((c) => c.pair_id === result.pair_id) || result;
        } else {
          toast('Client verified.');
        }
        render();
      } catch (err) { toast(err.message, true); }
    };
  };
  render();
}

/* ---------------- plans ---------------- */

async function viewPlans(view) {
  const plans = await API.get('/api/subscriptions');
  const currentPlan = plans.find((plan) => USER.subscription_id === plan.subscription_id && USER.is_vendor);
  view.innerHTML = `<section class="subscription-mobile"><header><a href="#/profile">‹</a><h3>Subscription Plans</h3></header>${currentPlan ? `<article class="active-plan"><small>CURRENT ACTIVE PLAN</small><span>Expires ${fmtDate(USER.sub_valid_to)}</span><h3>${esc(currentPlan.plan)}</h3><p>• Max Clients: ${currentPlan.number_of_clients} &nbsp; • Max Products: ${currentPlan.number_of_products}</p></article>` : `<article class="active-plan"><small>CURRENT ACTIVE PLAN</small><h3>Free Customer</h3><p>Choose a plan to unlock vendor tools.</p></article>`}<h4>Upgrade or Renew Options</h4><div class="subscription-options">
      ${plans
        .map((p) => {
          const current = USER.subscription_id === p.subscription_id && USER.is_vendor;
          return `<div class="plan-card ${current ? 'current' : ''}"><div class="plan-line"><b>${esc(p.plan)}</b><strong>${money(p.price)} / mo</strong></div>
            <ul>
              <li>${p.number_of_products} products</li>
              <li>${p.number_of_clients} clients</li>
              <li>${p.validity_days} days validity</li>
            </ul>
            <button class="btn ${current ? 'btn-outline' : 'btn-primary'} btn-block" data-buy="${p.subscription_id}">
              ${current ? 'Renew / extend' : USER.is_vendor ? 'Switch to ' + esc(p.plan) : 'Buy & become vendor'}
            </button>
          </div>`;
        })
        .join('')}
    </div></div></section>`;

  view.querySelectorAll('[data-buy]').forEach((btn) => {
    btn.onclick = async () => {
      const plan = plans.find((p) => p.subscription_id === Number(btn.dataset.buy));
      if (!confirmDialog(`Purchase the ${plan.plan} plan for ${money(plan.price)}?`)) return;
      try {
        USER = await API.post('/api/subscriptions/purchase', { subscription_id: plan.subscription_id });
        renderSidebar();
        updatePlanChip();
        toast(`🎉 You are now a vendor on the ${plan.plan} plan!`);
        location.hash = '#/vendor/products';
      } catch (err) {
        toast(err.message, true);
      }
    };
  });
}

/* ---------------- boot ---------------- */

async function boot() {
  if (!API.token) { location.href = '/'; return; }
  try {
    USER = await API.get('/api/auth/me');
  } catch {
    location.href = '/';
    return;
  }

  renderSidebar();
  renderMobileNav();
  applyTheme();
  updatePlanChip();
  refreshCartBadge();

  document.getElementById('logout-btn').onclick = () => {
    // End the session server-side too (single-session bookkeeping), then return to sign-in.
    API.post('/api/auth/logout').catch(() => {}).finally(() => {
      localStorage.removeItem('token');
      location.href = '/';
    });
  };
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  document.getElementById('menu-btn').onclick = () => {
    sidebar.classList.toggle('open');
    backdrop.classList.toggle('show');
  };
  backdrop.onclick = () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');
  };

  window.addEventListener('hashchange', route);
  route();
}

boot();
