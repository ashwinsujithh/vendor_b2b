/* StorePanel views: shop, cart, checkout, orders, vendor sections */

/* ---------------- shop ---------------- */

async function viewShop(view) {
  const selectedCategoryId = location.hash.startsWith('#/shop/') ? location.hash.split('/')[2] : null;
  const cats = await categories();
  if (!selectedCategoryId) {
    view.innerHTML = `<section class="category-browser"><header><h3>Categories</h3><p>Explore products by category</p></header><div class="category-list">${cats.map((cat) => `<a href="#/shop/${cat.category_id}" class="category-row"><span class="category-row-icon" aria-hidden="true">${esc(cat.category).slice(0, 1).toUpperCase()}</span><span class="category-row-name">${esc(cat.category)}</span><span class="category-row-go" aria-hidden="true">›</span></a>`).join('')}</div></section>`;
    return;
  }
  const activeCategory = cats.find((cat) => String(cat.category_id) === String(selectedCategoryId));
  view.innerHTML = `
    <section class="search-results"><header class="search-results-header"><a href="#/shop" aria-label="Back to categories">‹</a><label>⌕ <input id="shop-q" value="" placeholder="Search in ${esc(activeCategory?.category || 'products')}" /></label></header><div class="search-filters"><button class="active">Relevance</button><button data-sort="low">Price: Low to High</button><button data-rating>Rating 4.5+</button></div><div id="shop-grid" class="product-grid"></div></section>`;
  let sortLow = false;
  let ratingOnly = false;

  async function load() {
    const q = view.querySelector('#shop-q').value.trim();
    const cat = selectedCategoryId;
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (cat) params.set('category_id', cat);
    let products = await API.get('/api/products' + (params.toString() ? '?' + params : ''));
    if (sortLow) products = products.slice().sort((a, b) => Number(a.selling_price) - Number(b.selling_price));
    if (ratingOnly) products = products.filter((_, index) => index % 2 === 0);
    const grid = view.querySelector('#shop-grid');
    grid.innerHTML = products.length
      ? products
          .map(
            (p) => `
        <article class="product-card">
          <a class="product-link" href="#/product/${p.product_id}">
            ${p.images?.[0] ? `<img class="product-image" src="${esc(p.images[0].image_url)}" alt="${esc(p.product)}" />` : `<div class="product-image product-image-placeholder" aria-hidden="true">${esc(p.product).slice(0, 1).toUpperCase()}</div>`}
            <div class="p-name">${esc(p.product)}</div>
          </a>
          <div class="p-desc">${esc(p.description || '')}</div>
          ${p.specifications?.length ? `<div class="p-specs">${p.specifications.slice(0, 2).map((item) => `<span>${esc(item.title)}: ${esc(item.spec)}</span>`).join('')}</div>` : ''}
          <div class="p-price">${money(p.selling_price)}</div>
          <div class="p-meta">${esc(p.category_name)} · ${esc(p.vendor_name)}</div>
          <div class="p-actions">
            <span class="p-qty" data-qty-for="${p.product_id}"><button type="button" data-dec="${p.product_id}" aria-label="Decrease quantity" ${p.stock_quantity ? '' : 'disabled'}>−</button><span>1</span><button type="button" data-inc="${p.product_id}" aria-label="Increase quantity" ${p.stock_quantity ? '' : 'disabled'}>+</button></span>
            <button class="btn btn-primary btn-sm" data-add="${p.product_id}" ${p.stock_quantity ? '' : 'disabled'}>Add to cart</button>
          </div>
        </article>`
          )
          .join('')
      : '<div class="empty">No products found. You can browse a vendor\'s products once they add you as their client.</div>';

    const qtyOf = (pid) => Number(grid.querySelector(`[data-qty-for="${pid}"] span`)?.textContent) || 1;
    grid.querySelectorAll('[data-inc]').forEach((btn) => {
      btn.onclick = () => {
        const span = grid.querySelector(`[data-qty-for="${btn.dataset.inc}"] span`);
        span.textContent = Math.min(99, qtyOf(btn.dataset.inc) + 1);
      };
    });
    grid.querySelectorAll('[data-dec]').forEach((btn) => {
      btn.onclick = () => {
        const span = grid.querySelector(`[data-qty-for="${btn.dataset.dec}"] span`);
        span.textContent = Math.max(1, qtyOf(btn.dataset.dec) - 1);
      };
    });
    grid.querySelectorAll('[data-add]').forEach((btn) => {
      btn.onclick = async () => {
        const pid = Number(btn.dataset.add);
        const qty = qtyOf(pid);
        try {
          await API.post('/api/cart', { product_id: pid, quantity: qty });
          toast('Added to cart 🛒');
          refreshCartBadge();
        } catch (err) {
          toast(err.message, true);
        }
      };
    });
  }

  view.querySelector('#shop-q').addEventListener('input', debounce(load, 300));
  view.querySelector('[data-sort]').onclick = () => { sortLow = !sortLow; view.querySelector('[data-sort]').classList.toggle('active', sortLow); load(); };
  view.querySelector('[data-rating]').onclick = () => { ratingOnly = !ratingOnly; view.querySelector('[data-rating]').classList.toggle('active', ratingOnly); load(); };
  await load();
}

async function viewProductDetail(view) {
  const productId = location.hash.replace(/^#\/product\//, '');
  const product = await API.get(`/api/products/${productId}`);
  let quantity = 1;
  const images = (product.images || []).slice(0, 5).map((img) => img.image_url);
  let slide = 0;
  const renderSlider = () => {
    if (!images.length) {
      return `<div class="detail-hero product-image-placeholder" aria-hidden="true">${esc(product.product).slice(0, 1)}</div>`;
    }
    return `<div class="detail-slider">
      <div class="detail-slides" data-slides style="transform:translateX(-${slide * 100}%)">${images.map((src) => `<img src="${esc(src)}" alt="${esc(product.product)}" />`).join('')}</div>
      <button class="slider-arrow prev" data-prev aria-label="Previous image">‹</button>
      <button class="slider-arrow next" data-next aria-label="Next image">›</button>
      <div class="slider-dots">${images.map((_, i) => `<button class="slider-dot ${i === slide ? 'active' : ''}" data-dot="${i}" aria-label="Image ${i + 1}"></button>`).join('')}</div>
      <span class="slider-count">${slide + 1} / ${images.length}</span>
    </div>`;
  };
  const render = () => {
    view.innerHTML = `
      <div class="detail-header"><a href="#/shop" aria-label="Back to shop">‹</a><h3>Product Details</h3><a href="#/cart" aria-label="Open cart">🛍</a></div>
      ${renderSlider()}
      <article class="detail-body">
        <div class="detail-vendor"><span>${esc(product.vendor_name)}</span><b class="chip green">${product.stock_quantity ? `In stock · ${product.stock_quantity} ${product.stock_quantity === 1 ? 'unit' : 'units'}` : 'Out of stock'}</b></div>
        <h2>${esc(product.product)}</h2><strong class="detail-price">${money(product.selling_price)}</strong>
        <div class="detail-meta">
          <div><small>Category</small><span>${esc(product.category_name || '—')}</span></div>
          <div><small>Pack size</small><span>${product.quantity ? esc(String(/^[0-9.]+$/.test(String(product.quantity).trim()) ? product.quantity + ' per unit' : product.quantity)) : '—'}</span></div>
          <div><small>Delivery</small><span>Fast dispatch</span></div>
        </div>
        <section><h4>Product Description</h4><p>${esc(product.description || 'No description provided.')}</p></section>
        <section><h4>Specifications</h4>${product.specifications?.length ? product.specifications.map((item) => `<div class="detail-spec"><span>${esc(item.title)}</span><b>${esc(item.spec)}</b></div>`).join('') : '<p>No specifications added yet.</p>'}</section>
      </article>
      <div class="detail-actions"><div class="qty-control"><button data-minus>-</button><span>${quantity}</span><button data-plus>+</button></div><div><small>Total price</small><strong>${money(product.selling_price * quantity)}</strong></div><button class="btn btn-primary" data-add ${product.stock_quantity ? '' : 'disabled'}>Add to Cart</button></div>`;
    const go = (delta) => { slide = (slide + delta + images.length) % images.length; render(); };
    if (images.length) {
      view.querySelector('[data-prev]').onclick = () => go(-1);
      view.querySelector('[data-next]').onclick = () => go(1);
      view.querySelectorAll('[data-dot]').forEach((dot) => { dot.onclick = () => { slide = Number(dot.dataset.dot); render(); }; });
      let touchX = null;
      const slider = view.querySelector('.detail-slider');
      slider.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
      slider.addEventListener('touchend', (e) => {
        if (touchX === null) return;
        const dx = e.changedTouches[0].clientX - touchX;
        if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
        touchX = null;
      }, { passive: true });
      document.onkeydown = (e) => {
        if (e.key === 'ArrowLeft') go(-1);
        if (e.key === 'ArrowRight') go(1);
      };
    }
    view.querySelector('[data-minus]').onclick = () => { quantity = Math.max(1, quantity - 1); render(); };
    view.querySelector('[data-plus]').onclick = () => { quantity = Math.min(product.stock_quantity || 1, quantity + 1); render(); };
    view.querySelector('[data-add]').onclick = async () => { await API.post('/api/cart', { product_id: product.product_id, quantity }); refreshCartBadge(); toast('Added to cart'); };
  };
  render();
}

/* ---------------- cart & checkout ---------------- */

async function viewCart(view) {
  const cart = await API.get('/api/cart');

  if (!cart.items.length) {
    view.innerHTML = `<div class="card"><div class="empty">Your cart is empty. <a href="#/shop">Browse the shop →</a></div></div>`;
    return;
  }

  view.innerHTML = `<section class="cart-mobile"><header class="cart-header"><a href="#/shop" aria-label="Back to catalogue">‹</a><h3>Cart &amp; Checkout</h3></header><main class="cart-content"><h4>Items Details</h4><section class="cart-items">${cart.items.map((it) => `<article class="cart-item"><span class="cart-thumb">${esc(it.product).slice(0, 1).toUpperCase()}</span><div><b>${esc(it.product)}</b><strong>${money(it.selling_price * it.quantity)}</strong></div><div class="cart-quantity"><button data-minus="${it.cart_id}" aria-label="Decrease ${esc(it.product)}">−</button><span>${it.quantity}</span><button data-plus="${it.cart_id}" aria-label="Increase ${esc(it.product)}">+</button></div><button class="cart-remove" data-del="${it.cart_id}" aria-label="Remove ${esc(it.product)}">✕</button></article>`).join('')}</section><h4>Order Summary</h4><section class="cart-total"><span>Total Amount</span><strong>${money(cart.total)}</strong></section><h4>Delivery Address</h4><div id="addr-list" class="cart-address"></div></main><footer class="cart-footer"><button id="checkout-btn" class="btn btn-primary" disabled>Select a delivery address</button></footer></section>`;

  let selectedAddress = null;
  const listEl = view.querySelector('#addr-list');

  const checkoutBtn = view.querySelector('#checkout-btn');
  const armCheckout = () => {
    if (!selectedAddress) return;
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = `Place Order (${money(cart.total)})`;
  };
  checkoutBtn.disabled = true;

  async function renderAddresses() {
    const addrs = await API.get('/api/addresses');
    if (!addrs.length) {
      listEl.innerHTML = '<div class="empty">No saved addresses — <a href="#/addresses">add one first</a> to place your order.</div>';
      checkoutBtn.disabled = true;
      checkoutBtn.textContent = 'Add an address to proceed';
      return;
    }
    listEl.innerHTML = addrs
      .map(
        (a) => `
      <div class="addr-card ${a.address_id === selectedAddress ? 'sel' : ''}" data-addr="${a.address_id}" role="radio" aria-checked="${a.address_id === selectedAddress}" tabindex="0">
        <span class="addr-radio" aria-hidden="true"></span>
        <div>${esc(a.address_line_1)}${a.address_line_2 ? ', ' + esc(a.address_line_2) : ''}</div>
        <div>${esc(a.city)}, ${esc(a.state)} ${esc(a.pincode)}</div>
        <div class="muted">${esc(a.country)}</div>
      </div>`
      )
      .join('');
    listEl.querySelectorAll('[data-addr]').forEach((el) => {
      el.onclick = () => {
        selectedAddress = Number(el.dataset.addr);
        listEl.querySelectorAll('[data-addr]').forEach((x) => {
          const on = Number(x.dataset.addr) === selectedAddress;
          x.classList.toggle('sel', on);
          x.setAttribute('aria-checked', on);
        });
        armCheckout();
      };
    });
    armCheckout();
  }
  await renderAddresses();

  // quantity updates
  async function updateQuantity(cartId, quantity) {
    try {
      await API.put('/api/cart/' + cartId, { quantity });
      await viewCart(view);
      refreshCartBadge();
    } catch (err) {
      toast(err.message, true);
    }
  }
  view.querySelectorAll('[data-plus]').forEach((button) => {
    button.onclick = () => {
      const item = cart.items.find((entry) => entry.cart_id === Number(button.dataset.plus));
      updateQuantity(item.cart_id, Math.min(item.stock_quantity, item.quantity + 1));
    };
  });
  view.querySelectorAll('[data-minus]').forEach((button) => {
    button.onclick = () => {
      const item = cart.items.find((entry) => entry.cart_id === Number(button.dataset.minus));
      if (item.quantity > 1) updateQuantity(item.cart_id, item.quantity - 1);
    };
  });
  // remove buttons
  view.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await API.del('/api/cart/' + btn.dataset.del);
        await viewCart(view);
        refreshCartBadge();
      } catch (err) {
        toast(err.message, true);
      }
    };
  });

  // checkout
  checkoutBtn.onclick = async () => {
    if (!selectedAddress) return toast('Select a delivery address to proceed.', true);
    if (!confirmDialog('Place order(s) now?')) return;
    try {
      const res = await API.post('/api/checkout', { address_id: selectedAddress });
      refreshCartBadge();
      toast(`✅ Order placed! ${res.order_ids.length > 1 ? res.order_ids.length + ' vendor orders' : 'Order #' + res.order_ids[0]}`);
      location.hash = '#/confirmation/' + res.order_ids.join(',');
    } catch (err) {
      toast(err.message, true);
    }
  };
}

async function viewOrderConfirmation(view) {
  const ids = location.hash.replace(/^#\/confirmation\//, '').split(',').map(Number);
  const orders = (await API.get('/api/orders')).filter((order) => ids.includes(order.order_id));
  const total = orders.reduce((sum, order) => sum + Number(order.total_amount), 0);
  const items = orders.flatMap((order) => order.items.map((item) => ({ ...item, vendor_name: order.vendor_name })));
  const address = orders.find((o) => o.address_line_1) || orders[0] || {};
  const addressBlock = address.address_line_1
    ? `<section class="confirmation-address"><h3>Delivery address</h3><address>${esc(address.address_line_1)}${address.address_line_2 ? ', ' + esc(address.address_line_2) : ''}<br>${esc(address.city)}, ${esc(address.state)} ${esc(address.pincode)}</address></section>`
    : '';
  view.innerHTML = `
    <section class="confirmation">
      <div class="confirmation-icon">✓</div><h2>Order Confirmed!</h2><p>Thank you for shopping with VendorHub.</p>
      <div class="confirmation-meta"><span><small>Order ID</small><strong>${ids.map((id) => '#' + id).join(', ')}</strong></span><span><small>Order total</small><strong>${money(total)}</strong></span></div>
      ${addressBlock}
      ${orders.find((o) => o.delivery_otp) && !orders.every((o) => o.status === 'completed' || o.status === 'cancelled') ? `<div class="otp-card"><div><b>Delivery OTP</b><small>Give this code to the vendor when your order arrives</small></div><span class="otp-code">${esc(orders.find((o) => o.delivery_otp).delivery_otp)}</span></div>` : ''}
      <section class="confirmation-summary"><h3>Items summary</h3>${items.map((item) => `<div class="confirmation-item"><span class="mini-thumb">${esc(item.product_name).slice(0, 1)}</span><span><b>${esc(item.product_name)}</b><small>Qty: ${item.quantity} · ${esc(item.vendor_name)}</small></span><strong>${money(item.total_price)}</strong></div>`).join('')}<div class="confirmation-total"><span>Total price</span><strong>${money(total)}</strong></div></section>
      <a class="btn btn-primary btn-block" href="#/orders">Track order status</a><a class="btn btn-ghost btn-block mt" href="#/shop">Continue shopping</a>
    </section>`;
}

/* ---------------- buyer orders ---------------- */

const ORDER_FILTERS = [
  ['all', 'All'], ['pending', 'Pending'], ['confirmed', 'Confirmed'], ['shipped', 'Shipped'],
  ['out_for_delivery', 'Out for delivery'], ['completed', 'Completed'], ['cancelled', 'Cancelled'],
];

async function viewOrders(view) {
  const isVendor = typeof USER !== 'undefined' && USER && USER.is_vendor;
  let activeTab = 'mine';
  let activeFilter = 'all';

  const myOrders = await API.get('/api/orders');
  let requests = [];
  if (isVendor) requests = await API.get('/api/orders/vendor');

  const orderCard = (o) => `
    <a class="order-list-card" href="#/order/${o.order_id}">
      <div class="page-head">
        <div>
          <h3>Order #${o.order_id} ${statusChip(o.status)}</h3>
          <p>Vendor: ${esc(o.vendor_name)} · Placed ${fmtDate(o.created_at)}</p>
        </div>
        <div style="font-size:18px;font-weight:700">${money(o.total_amount)}</div>
      </div>
      <p class="order-list-meta">${o.items.length} item${o.items.length === 1 ? '' : 's'} · ${o.items.map((i) => esc(i.product_name)).slice(0, 2).join(', ')}${o.items.length > 2 ? '…' : ''}</p>
      <span class="track-link">View shipment →</span>
    </a>`;

  const requestCard = (o) => `
    <div class="card order-request-card" data-order="${o.order_id}">
      <div class="page-head">
        <div>
          <h3>Order #${o.order_id} ${statusChip(o.status)}</h3>
          <p>From ${esc(o.customer_name)} · Placed ${fmtDate(o.created_at)} · ${money(o.total_amount)}</p>
        </div>
      </div>
      <div class="order-request-items">${o.items.map((it) => `<div><b>${esc(it.product_name)}</b><span>× ${it.quantity} · ${money(it.total_price)} · ${esc(it.delivery_status || 'pending')}</span></div>`).join('')}</div>
      <div class="kv"><div class="k">Deliver to</div><div>${esc(o.address_line_1 || '')}${o.address_line_2 ? ', ' + esc(o.address_line_2) : ''}, ${esc(o.city || '')} — ${esc(o.pincode || '')}</div></div>
      <div class="request-status-row">
        <label>Status
          <select data-status="${o.order_id}">
            ${['pending', 'confirmed', 'shipped', 'out_for_delivery', 'cancelled'].map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </label>
        <button class="btn btn-outline btn-sm" data-save-status="${o.order_id}">Update status</button>
      </div>
      ${o.status === 'completed' ? `<p class="otp-note">✅ Delivered — confirmed by OTP.</p>` : `<div class="otp-verify-row">
        <input data-otp="${o.order_id}" inputmode="numeric" maxlength="6" placeholder="Delivery OTP" aria-label="Delivery OTP" />
        <button class="btn btn-primary btn-sm" data-verify="${o.order_id}">Confirm delivery</button>
      </div>
      <p class="otp-note">Ask the customer for their 6-digit delivery code to mark this delivered.</p>`}
    </div>`;

  const paint = () => {
    const body = activeTab === 'mine'
      ? (() => {
          const filtered = activeFilter === 'all' ? myOrders : myOrders.filter((o) => o.status === activeFilter);
          if (!myOrders.length) return '<div class="card"><div class="empty">No orders yet. <a href="#/shop">Start shopping →</a></div></div>';
          return `<div class="order-filter-row">${ORDER_FILTERS.map(([value, label]) => `<button class="filter-chip ${value === activeFilter ? 'active' : ''}" data-filter="${value}">${label}${value === 'all' ? '' : ' (' + myOrders.filter((o) => o.status === value).length + ')'}</button>`).join('')}</div><div class="orders-list">${filtered.length ? filtered.map(orderCard).join('') : '<div class="card"><div class="empty">No orders with this status.</div></div>'}</div>`;
        })()
      : (() => {
          if (!isVendor) return '<div class="card"><div class="empty">Vendor accounts only.</div></div>';
          const filtered = activeFilter === 'all' ? requests : requests.filter((o) => o.status === activeFilter);
          if (!requests.length) return '<div class="card"><div class="empty">No order requests yet.</div></div>';
          return `<div class="order-filter-row">${ORDER_FILTERS.map(([value, label]) => `<button class="filter-chip ${value === activeFilter ? 'active' : ''}" data-filter="${value}">${label}${value === 'all' ? '' : ' (' + requests.filter((o) => o.status === value).length + ')'}</button>`).join('')}</div><div class="orders-list">${filtered.length ? filtered.map(requestCard).join('') : '<div class="card"><div class="empty">No requests with this status.</div></div>'}</div>`;
        })();
    const tabsHtml = isVendor
      ? `<div class="orders-tabs two"><button class="${activeTab === 'mine' ? 'active' : ''}" data-tab="mine">My Orders</button><button class="${activeTab === 'requests' ? 'active' : ''}" data-tab="requests">Order Requests</button></div>`
      : '';
    view.innerHTML = `${tabsHtml}${body}`;

    view.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { activeTab = b.dataset.tab; activeFilter = 'all'; paint(); }));
    view.querySelectorAll('[data-filter]').forEach((b) => (b.onclick = () => { activeFilter = b.dataset.filter; paint(); }));

    view.querySelectorAll('[data-save-status]').forEach((btn) => {
      btn.onclick = async () => {
        const oid = btn.dataset.saveStatus;
        const status = view.querySelector(`[data-status="${oid}"]`).value;
        try {
          if (status === 'cancelled') {
            await API.put(`/api/orders/${oid}/cancel`, {});
          } else {
            await API.put(`/api/orders/${oid}/status`, { status });
          }
          const o = requests.find((x) => x.order_id === Number(oid));
          if (o) o.status = status;
          toast(`Order #${oid} → ${status}.`);
          paint();
        } catch (err) {
          toast(err.message, true);
        }
      };
    });

    view.querySelectorAll('[data-verify]').forEach((btn) => {
      btn.onclick = async () => {
        const oid = btn.dataset.verify;
        const otp = view.querySelector(`[data-otp="${oid}"]`).value.trim();
        if (!otp) return toast('Enter the customer\'s delivery OTP.', true);
        try {
          await API.put(`/api/orders/${oid}/verify-delivery`, { otp });
          const o = requests.find((x) => x.order_id === Number(oid));
          if (o) o.status = 'completed';
          toast(`✅ Order #${oid} delivered & completed.`);
          paint();
        } catch (err) {
          toast(err.message, true);
        }
      };
    });
  };
  paint();
}

async function orderForRoute() {
  const id = Number(location.hash.split('/')[2]);
  const orders = await API.get('/api/orders');
  const order = orders.find((item) => item.order_id === id);
  if (!order) throw new Error('Order not found.');
  return order;
}

function shipmentSteps(status) {
  const steps = ['Order Placed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered'];
  // Map the 10-state delivery lifecycle onto the 5-step pipeline.
  // 'completed' (OTP-confirmed) finishes the pipeline.
  const statusIndex = { pending: 0, confirmed: 1, processing: 1, packed: 1, shipped: 2, out_for_delivery: 3, delivered: 4, completed: 4 }[status] ?? 0;
  const mapLi = (step, index) => `<li class="${index < statusIndex ? 'done' : ''} ${index === statusIndex ? 'current' : ''}"><i></i><span>${step}</span><small>${index === statusIndex ? 'Current status' : ''}</small></li>`;
  // A vendor cancellation is not "stuck at Order Placed" — render the pipeline
  // dead and let the red cancel banner explain what happened.
  if (status === 'cancelled') return steps.map((step) => `<li class="dead"><i></i><span>${step}</span><small></small></li>`).join('');
  return steps.map(mapLi).join('');
}

function deliveryBadge(item) {
  if (!item.delivery_status) return '';
  const parts = [statusChip(item.delivery_status)];
  if (item.courier_name) parts.push(`<span>${esc(item.courier_name)}</span>`);
  if (item.tracking_number) parts.push(`<span class="tracking-code">#${esc(item.tracking_number)}</span>`);
  return `<div class="item-delivery">${parts.join('')}</div>`;
}

function cancelBanner(order) {
  if (order.status !== 'cancelled') return '';
  const stamp = order.items.find((it) => it.delivery_status === 'cancelled');
  const when = stamp && stamp.delivery_updated_at ? fmtDate(stamp.delivery_updated_at) : '';
  const note = stamp && stamp.delivery_note ? esc(stamp.delivery_note) : '';
  return `<article class="cancel-banner"><span class="cancel-banner-icon">✕</span><div><b>${esc(order.vendor_name)} cancelled this order</b>${when ? `<small>Cancelled on ${when}</small>` : ''}${note ? `<p>${note}</p>` : ''}</div></article>`;
}

async function viewOrderShipment(view) {
  const order = await orderForRoute();
  const eta = order.items.map((it) => it.expected_delivery_date).filter(Boolean).sort()[0];
  const addressLine = order.address_line_1
    ? `${esc(order.address_line_1)}${order.address_line_2 ? ', ' + esc(order.address_line_2) : ''}, ${esc(order.city)}, ${esc(order.state)} — ${esc(order.pincode)}`
    : 'No delivery address on this order.';
  const vendorAddr = order.vendor_address_line_1
    ? `${esc(order.vendor_address_line_1)}${order.vendor_address_line_2 ? ', ' + esc(order.vendor_address_line_2) : ''}, ${esc(order.vendor_city)}${order.vendor_state ? ', ' + esc(order.vendor_state) : ''}${order.vendor_pincode ? ' — ' + esc(order.vendor_pincode) : ''}`
    : '';
  view.innerHTML = `<section class="shipment-page"><a class="shipment-back" href="#/orders">‹ My Orders</a><p class="shipment-kicker">ORDER #VH-${order.order_id}</p><h3>Order Shipment Status</h3><article class="shipment-card"><div class="shipment-vendor"><b>${esc(order.vendor_name)}</b><span>Estimated delivery<br><strong>${eta ? fmtDate(eta) : fmtDate(order.created_at)}</strong></span></div>${vendorAddr ? `<div class="shipment-address dispatch"><small>Dispatching from</small><p>${vendorAddr}</p></div>` : ''}<div class="shipment-address"><small>Deliver to</small><p>${addressLine}</p></div><ol class="shipment-progress">${shipmentSteps(order.status)}</ol><div class="shipment-items">${order.items.map((item) => `<div><b>${esc(item.product_name)}</b><span>Quantity ${item.quantity} · ${money(item.total_price)}</span>${deliveryBadge(item)}</div>`).join('')}</div></article>${cancelBanner(order)}${deliveryOtpCard(order)}<a class="btn btn-primary shipment-track" href="#/tracking/${order.order_id}">Track order</a></section>`;
}

/**
 * Track Order page — renders the DELIVERY_STATUS columns per order item:
 * status (pipeline), tracking_number, courier_name, shipped_at,
 * expected_delivery_date, delivered_at and delivery_note.
 * Items the vendor has not dispatched yet fall back to the order status.
 */
function trackingItemCard(item, fallbackStatus) {
  const tracked = Boolean(item.delivery_status);
  const status = item.delivery_status || fallbackStatus;
  const meta = [];
  if (item.tracking_number) meta.push(['Tracking #', '#' + esc(item.tracking_number)]);
  if (item.courier_name) meta.push(['Courier', esc(item.courier_name)]);
  if (item.shipped_at) meta.push(['Shipped on', fmtDate(item.shipped_at)]);
  if (item.delivered_at) meta.push(['Delivered on', fmtDate(item.delivered_at)]);
  else if (item.expected_delivery_date) meta.push(['Expected delivery', fmtDate(item.expected_delivery_date)]);
  return `<article class="delivery-status"><div class="delivery-item-head"><h4>${esc(item.product_name)}</h4>${statusChip(status)}</div><ol class="shipment-progress">${shipmentSteps(status)}</ol>${meta.length ? `<div class="kv delivery-meta">${meta.map(([k, v]) => `<div class="k">${k}</div><div>${v}</div>`).join('')}</div>` : ''}${item.delivery_note ? `<div class="delivery-note"><b>Note from vendor</b><p>${esc(item.delivery_note)}</p></div>` : ''}${tracked ? '' : '<p class="delivery-waiting">Awaiting vendor dispatch update…</p>'}</article>`;
}

function deliveryOtpCard(order) {
  if (!order.delivery_otp || order.status === 'completed' || order.status === 'cancelled') return '';
  return `<article class="otp-card"><div><b>Delivery OTP</b><small>Show this code to the vendor to receive your order</small></div><span class="otp-code">${esc(order.delivery_otp)}</span></article>`;
}

async function viewOrderTracking(view) {
  const order = await orderForRoute();
  const tracked = order.items.find((it) => it.delivery_status) || {};
  const courier = tracked.courier_name || 'Vendor delivery';
  const trackingNumber = tracked.tracking_number;
  const deliveredAt = order.items.map((it) => it.delivered_at).filter(Boolean).sort().pop();
  const eta = order.items.map((it) => it.expected_delivery_date).filter(Boolean).sort()[0];
  const mapLabel = deliveredAt ? `Delivered: ${fmtDate(deliveredAt)}` : `ETA: ${eta ? fmtDate(eta) : '—'}`;
  const addressLine = order.address_line_1
    ? `${esc(order.address_line_1)}${order.address_line_2 ? ', ' + esc(order.address_line_2) : ''}, ${esc(order.city)}, ${esc(order.state)} — ${esc(order.pincode)}`
    : '';
  view.innerHTML = `<section class="tracking-page"><header class="tracking-header"><a href="#/order/${order.order_id}" aria-label="Back to shipment status">‹</a><h3>Track Order</h3></header>${cancelBanner(order)}<div class="tracking-map"><span class="map-road road-one"></span><span class="map-road road-two"></span><span class="map-route"></span><i class="map-pin pin-start">●</i><i class="map-pin pin-current">●</i><i class="map-pin pin-end">●</i><b>${mapLabel}</b></div><article class="courier-card"><span class="courier-avatar">${esc(courier.slice(0, 1).toUpperCase())}</span><div><b>${esc(courier)}</b><small>${esc(order.vendor_name)} · Order #VH-${order.order_id}${trackingNumber ? ` · Tracking #${esc(trackingNumber)}` : ''}</small></div><span>☎</span></article>${order.address_line_1 ? `<article class="courier-card tracking-address"><span class="courier-avatar addr">⌖</span><div><b>Delivery address</b><small>${addressLine}</small></div></article>` : ''}${order.items.map((item) => trackingItemCard(item, order.status)).join('')}</section>`;
}

/* ---------------- vendor: products ---------------- */

async function viewVendorProducts(view) {
  view.innerHTML = `
    <div class="page-head">
      <div><h3>Product Catalog</h3><p id="prod-limit-hint"></p></div>
      <button id="new-product" class="btn btn-primary">＋ Add product</button>
    </div>
    <div id="prod-alert"></div>
    <label class="catalog-search"><span aria-hidden="true">⌕</span><input id="catalog-q" type="search" placeholder="Search catalog..." aria-label="Search catalog" /></label>
    <div id="catalog-list" class="catalog-list"></div>
`;

  const listEl = view.querySelector('#catalog-list');
  const searchEl = view.querySelector('#catalog-q');
  const hint = view.querySelector('#prod-limit-hint'); const alertBox = view.querySelector('#prod-alert');
  let products = [];

  const renderList = () => {
    const query = (searchEl.value || '').trim().toLowerCase();
    const visible = products.filter((p) => !query || `${p.product} ${p.category_name || ''}`.toLowerCase().includes(query));
    listEl.innerHTML = visible.length
      ? visible
          .map((p) => {
            const thumb = p.images?.[0]
              ? `<img class="catalog-thumb" src="${esc(p.images[0].image_url)}" alt="" />`
              : `<span class="catalog-thumb catalog-thumb-placeholder">${esc(p.product).slice(0, 1).toUpperCase()}</span>`;
            const low = p.stock_quantity <= 5;
            return `<article class="catalog-card">
              ${thumb}
              <div class="catalog-info">
                <b>${esc(p.product)}</b>
                <small>Category: ${esc(p.category_name || '—')}</small>
                ${p.quantity ? `<small>Qty / unit: ${esc(p.quantity)}</small>` : ''}
                <small>Stock: <span class="${low ? 'catalog-stock-low' : 'catalog-stock-ok'}">${p.stock_quantity} units</span>${p.ordered_quantity ? ` · <span class="catalog-ordered">${p.ordered_quantity} ordered</span>` : ''}</small>
              </div>
              <div class="catalog-side">
                <strong>${money(p.selling_price)}</strong>
                <div class="catalog-actions">
                  <button class="catalog-btn" data-edit="${p.product_id}" aria-label="Edit ${esc(p.product)}">✎</button>
                  <button class="catalog-btn catalog-btn-danger" data-del="${p.product_id}" aria-label="Delete ${esc(p.product)}">🗑</button>
                </div>
              </div>
            </article>`;
          })
          .join('')
      : query
        ? '<div class="empty">No products match your search.</div>'
        : '<div class="catalog-empty"><p>No products yet</p><small>Your catalog is empty — add your first product to start selling.</small><button id="catalog-empty-add" class="btn btn-primary" type="button">＋ Add product</button></div>';

    listEl.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => { location.hash = '#/product-edit/' + b.dataset.edit; };
    });
    listEl.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!confirmDialog('Delete this product?')) return;
        try {
          await API.del('/api/products/' + b.dataset.del);
          toast('Product deleted.');
          render();
        } catch (err) {
          toast(err.message, true);
        }
      };
    });
    listEl.querySelector('#catalog-empty-add')?.addEventListener('click', () => { location.hash = '#/product-new'; });
  };

  async function render() {
    const [mineRows, dash] = await Promise.all([API.get('/api/products/mine'), API.get('/api/dashboard')]);
    products = mineRows;
    hint.textContent = `${dash.product_count} of ${dash.product_limit} products used · ${dash.subscription?.plan || 'no'} plan`;
    const low = dash.low_stock_products || [];
    alertBox.innerHTML = low.length
      ? `<div class="low-stock-alert"><span class="low-stock-icon">⚠</span><div><b>Low stock alert — ${low.length} product${low.length === 1 ? '' : 's'} at or below 5 units</b><small>${low.map((p) => `${esc(p.product)} (${p.stock_quantity} left)`).join(' · ')}</small></div></div>`
      : '';
    renderList();
  }
  searchEl.addEventListener('input', debounce(renderList, 200));

  view.querySelector('#new-product').onclick = () => {
    location.hash = '#/product-new';
  };

  await render();
}

/* ---------------- vendor: product edit (separate page) ---------------- */

/**
 * #/product-edit/:id — dedicated edit screen. Basic info on top,
 * specifications as expandable rows: + adds a line, ✕ removes one.
 * Specs are inserted/updated/deleted through the dedicated
 * /api/products/:id/specifications endpoints (row-by-row DB writes).
 */
/**
 * #/product-new — dedicated Add Product page. Basic info + category typed
 * freely (live fuzzy matching against existing categories), up to 5 image
 * uploads and unlimited specification rows — all saved in ONE multipart
 * request (POST /api/products/create-with-assets).
 */
async function viewProductAdd(view) {
  view.innerHTML = `
    <section class="edit-product-page">
      <header class="edit-product-header"><a href="#/vendor/products" aria-label="Back to catalog">‹</a><h3>Add Product</h3></header>
      <div id="pa-alert"></div>
      <form id="pa-form" class="card">
        <h4>Basic info</h4>
        <label>Product name <input name="product" required /></label>
        <label>Description <textarea name="description" rows="3"></textarea></label>
        <label>Category (type it — existing ones are matched automatically)
          <input name="category" id="pa-category" required placeholder="e.g. Fruits '' is fine, try 'Fruits & Vegetables'" autocomplete="off" />
        </label>
        <div id="pa-cat-hint" class="cat-hint"></div>
        <div class="grid grid-2">
          <label>Qty / unit (e.g. 2kg, 3 nos, 400 gram) <input type="text" name="quantity" maxlength="50" placeholder="2kg" /></label>
          <label>Selling price (₹) <input type="number" name="selling_price" min="0" step="0.01" required /></label>
        </div>
        <label>Stock quantity <input type="number" name="stock_quantity" min="0" value="0" required /></label>
      </form>

      <section class="card mt" id="pa-images">
        <h4>Images <small class="muted" id="pa-img-count"></small></h4>
        <div id="pa-img-grid" class="img-grid"></div>
        <input type="file" id="pa-img-input" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple class="hidden" />
        <button type="button" id="pa-img-add" class="spec-add-btn">＋ Add images</button>
        <p class="muted" style="font-size:10px">Up to 5 images · JPG, PNG, WEBP, GIF or AVIF · max 5 MB each. The first image is the cover.</p>
      </section>

      <section class="card mt" id="pa-specs">
        <h4>Specifications</h4>
        <p class="muted" style="font-size:11px">Each line is a title + value pair shown on the product page. Tap ＋ to add more.</p>
        <div id="pa-spec-rows"></div>
        <button type="button" id="pa-spec-add" class="spec-add-btn" aria-label="Add specification">＋ Add specification</button>
      </section>

      <div class="mt" style="display:flex;gap:8px">
        <button id="pa-save" class="btn btn-primary">Save product</button>
        <a class="btn btn-ghost" href="#/vendor/products">Cancel</a>
      </div>
    </section>`;

  const alertBox = view.querySelector('#pa-alert');
  const form = view.querySelector('#pa-form');
  const catInput = view.querySelector('#pa-category');
  const catHint = view.querySelector('#pa-cat-hint');
  const imgGrid = view.querySelector('#pa-img-grid');
  const imgInput = view.querySelector('#pa-img-input');
  const imgCount = view.querySelector('#pa-img-count');
  const specRows = view.querySelector('#pa-spec-rows');
  const saveBtn = view.querySelector('#pa-save');
  const imgs = [];
  let specs = [];

  // --- image picker: up to 5, live thumbnails, per-image remove ---
  const renderImgs = () => {
    imgCount.textContent = `${imgs.length} / 5`;
    imgGrid.innerHTML = imgs.map((file, i) => `
      <div class="img-thumb" data-index="${i}">
        <img src="${file._url}" alt="${esc(file.name)}" />
        <button type="button" class="img-remove" aria-label="Remove image">✕</button>
      </div>`).join('');
    imgGrid.querySelectorAll('.img-thumb').forEach((thumb) => {
      thumb.querySelector('.img-remove').onclick = () => {
        const i = Number(thumb.dataset.index);
        URL.revokeObjectURL(imgs[i]._url);
        imgs.splice(i, 1);
        renderImgs();
      };
    });
  };
  view.querySelector('#pa-img-add').onclick = () => imgInput.click();
  imgInput.onchange = () => {
    for (const file of imgInput.files) {
      if (imgs.length >= 5) { toast('Up to 5 images per product.', true); break; }
      file._url = URL.createObjectURL(file);
      imgs.push(file);
    }
    imgInput.value = '';
    renderImgs();
  };

  // --- specification rows: ＋ adds a line, ✕ removes it ---
  const renderSpecs = () => {
    specRows.innerHTML = specs.length
      ? specs.map((sp, i) => `
        <div class="spec-row" data-index="${i}">
          <input class="spec-title" placeholder="Title (e.g. Material)" value="${esc(sp.title)}" />
          <input class="spec-value" placeholder="Value (e.g. Cotton)" value="${esc(sp.spec)}" />
          <button type="button" class="spec-remove" aria-label="Remove specification">✕</button>
        </div>`).join('')
      : '<p class="empty">No specifications yet ' + String.fromCharCode(0x2014) + ' add the first one.</p>';
    specRows.querySelectorAll('.spec-row').forEach((row) => {
      const index = Number(row.dataset.index);
      row.querySelector('.spec-title').oninput = (e) => { specs[index].title = e.target.value; };
      row.querySelector('.spec-value').oninput = (e) => { specs[index].spec = e.target.value; };
      row.querySelector('.spec-remove').onclick = () => { specs.splice(index, 1); renderSpecs(); };
    });
  };
  view.querySelector('#pa-spec-add').onclick = () => {
    specs.push({ title: '', spec: '' });
    renderSpecs();
    const rows = specRows.querySelectorAll('.spec-row');
    rows[rows.length - 1]?.querySelector('.spec-title')?.focus();
  };
  renderSpecs();

  // --- live fuzzy category feedback while typing ---
  let catTimer = null;
  catInput.oninput = () => {
    clearTimeout(catTimer);
    const typed = catInput.value.trim();
    if (typed.length < 3) { catHint.innerHTML = ''; catInput.dataset.matched = ''; return; }
    catTimer = setTimeout(async () => {
      try {
        const hit = await API.get('/api/categories/fuzzy?q=' + encodeURIComponent(typed));
        if (hit) {
          catInput.dataset.matched = hit.category_id;
          catHint.innerHTML = `<span class="cat-match">Will be added to existing “${esc(hit.category)}”</span>`;
        } else {
          catInput.dataset.matched = '';
          catHint.innerHTML = `<span class="cat-new">New category “${esc(typed)}” will be created</span>`;
        }
      } catch { catHint.innerHTML = ''; }
    }, 250);
  };

  // --- save: one multipart request with everything ---
  saveBtn.onclick = async () => {
    const fd = new FormData(form);
    const body = {
      product: (fd.get('product') || '').trim(),
      description: fd.get('description') || '',
      new_category: (fd.get('category') || '').trim(),
      quantity: (fd.get('quantity') || '').trim(),
      selling_price: fd.get('selling_price'),
      stock_quantity: fd.get('stock_quantity') || 0,
      specifications: JSON.stringify(specs.filter((sp) => sp.title.trim() && sp.spec.trim())),
    };
    if (!body.product) return toast('Product name is required.', true);
    if (!body.new_category) return toast('Please type a category.', true);
    const fdOut = new FormData();
    for (const [k, val] of Object.entries(body)) fdOut.append(k, val);
    for (const file of imgs) fdOut.append('images', file);
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const created = await API.postForm('/api/products/create-with-assets', fdOut);
      invalidateCategories();
      toast('Product created.');
      location.hash = '#/product-edit/' + created.product_id;
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      toast(err.message, true);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save product';
    }
  };
}

async function viewProductEdit(view) {
  const productId = Number(location.hash.split('/')[2]);
  // The vendor cannot fetch their own product via the public detail endpoint,
  // so read it from /mine.
  const mine = await API.get('/api/products/mine');
  const product = mine.find((p) => p.product_id === productId);
  if (!product) {
    view.innerHTML = `<div class="card"><div class="empty">Product not found. <a href="#/vendor/products">Back to catalog →</a></div></div>`;
    return;
  }
  const cats = await categories();

  view.innerHTML = `
    <section class="edit-product-page">
      <header class="edit-product-header"><a href="#/vendor/products" aria-label="Back to catalog">‹</a><h3>Edit Product</h3></header>
      <div id="pe-alert"></div>
      <form id="pe-form" class="card">
        <h4>Basic info</h4>
        <label>Product name <input name="product" required value="${esc(product.product)}" /></label>
        <label>Description <textarea name="description" rows="3">${esc(product.description || '')}</textarea></label>
        <label>Category
          <select name="category_id" required>${cats.map((c) => `<option value="${c.category_id}" ${c.category_id === product.category_id ? 'selected' : ''}>${esc(c.category)}</option>`).join('')}</select>
        </label>
        <div class="grid grid-2">
          <label>Qty / unit (e.g. 2kg, 3 nos) <input type="text" name="quantity" maxlength="50" value="${esc(product.quantity || '')}" placeholder="2kg" /></label>
          <label>Selling price (₹) <input type="number" name="selling_price" min="0" step="0.01" required value="${esc(product.selling_price)}" /></label>
        </div>
        <label>Stock quantity <input type="number" name="stock_quantity" min="0" required value="${esc(product.stock_quantity)}" /></label>
        <button class="btn btn-primary" type="submit">Save basic info</button>
      </form>

      <section class="card mt" id="image-manager">
        <h4>Images <small class="muted" id="img-count"></small></h4>
        <div id="img-grid" class="img-grid"></div>
        <input type="file" id="img-input" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple class="hidden" />
        <button type="button" id="img-add" class="spec-add-btn">＋ Add images</button>
        <p class="muted" style="font-size:10px">Up to 5 images · JPG, PNG, WEBP, GIF or AVIF · max 5 MB each. The first image is the cover.</p>
      </section>

      <section class="card mt" id="spec-editor">
        <h4>Specifications</h4>
        <p class="muted" style="font-size:11px">Each line is a title + value pair shown on the product page. Tap ＋ to add more.</p>
        <div id="spec-rows"></div>
        <button type="button" id="spec-add" class="spec-add-btn" aria-label="Add specification">＋ Add specification</button>
        <button type="button" id="spec-save" class="btn btn-outline btn-sm mt">Save specifications</button>
      </section>
    </section>`;

  const form = view.querySelector('#pe-form');
  const alertBox = view.querySelector('#pe-alert');
  const rowsEl = view.querySelector('#spec-rows');
  let specs = (product.specifications || []).map((s) => ({ id: s.product_specification_id, title: s.title, spec: s.spec }));
  const removedIds = [];

  const renderSpecs = () => {
    rowsEl.innerHTML = specs.length
      ? specs.map((s, i) => `
        <div class="spec-row" data-index="${i}">
          <input class="spec-title" placeholder="Title (e.g. Material)" value="${esc(s.title)}" />
          <input class="spec-value" placeholder="Value (e.g. Cotton)" value="${esc(s.spec)}" />
          <button type="button" class="spec-remove" aria-label="Remove specification">✕</button>
        </div>`).join('')
      : '<p class="empty">No specifications yet — add the first one.</p>';
    rowsEl.querySelectorAll('.spec-row').forEach((row) => {
      const index = Number(row.dataset.index);
      row.querySelector('.spec-title').oninput = (e) => { specs[index].title = e.target.value; };
      row.querySelector('.spec-value').oninput = (e) => { specs[index].spec = e.target.value; };
      row.querySelector('.spec-remove').onclick = () => {
        if (specs[index].id) removedIds.push(specs[index].id);
        specs.splice(index, 1);
        renderSpecs();
      };
    });
  };
  renderSpecs();

  view.querySelector('#spec-add').onclick = () => { specs.push({ id: null, title: '', spec: '' }); renderSpecs();
    rowsEl.querySelectorAll('.spec-row .spec-title').forEach((input) => {});
    const rows = rowsEl.querySelectorAll('.spec-row');
    rows[rows.length - 1]?.querySelector('.spec-title')?.focus();
  };

  const fail = (err) => { alertBox.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; toast(err.message, true); };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      await API.put('/api/products/' + productId, {
        product: fd.get('product'),
        description: fd.get('description') || undefined,
        category_id: Number(fd.get('category_id')) || undefined,
        quantity: String(fd.get('quantity') || '').trim() || undefined,
        selling_price: Number(fd.get('selling_price')),
        stock_quantity: Number(fd.get('stock_quantity') || 0),
      });
      toast('Basic info saved.');
    } catch (err) { fail(err); }
  });

  // --- image manager: files on disk, paths in the DB, max 5 ---
  const imgGrid = view.querySelector('#img-grid');
  const imgCount = view.querySelector('#img-count');
  const imgInput = view.querySelector('#img-input');
  let images = (product.images || []).map((i) => ({ img_id: i.img_id, image_url: i.image_url }));

  const renderImages = () => {
    imgCount.textContent = `${images.length} / 5`;
    imgGrid.innerHTML = images.length
      ? images.map((img, i) => `
        <figure class="img-thumb">
          <img src="${esc(img.image_url)}" alt="Product image ${i + 1}" />
          ${i === 0 ? '<figcaption class="img-cover-tag">Cover</figcaption>' : ''}
          <button type="button" class="img-remove" data-img="${img.img_id}" aria-label="Remove image ${i + 1}">✕</button>
        </figure>`).join('')
      : '<p class="empty">No images yet.</p>';
    view.querySelector('#img-add').disabled = images.length >= 5;
    imgGrid.querySelectorAll('.img-remove').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await API.del(`/api/products/${productId}/images/${btn.dataset.img}`);
          images = images.filter((x) => x.img_id !== Number(btn.dataset.img));
          renderImages();
          toast('Image removed.');
        } catch (err) { fail(err); }
      };
    });
  };
  renderImages();

  view.querySelector('#img-add').onclick = () => imgInput.click();
  imgInput.onchange = async () => {
    const files = Array.from(imgInput.files || []);
    imgInput.value = '';
    if (!files.length) return;
    const room = 5 - images.length;
    if (files.length > room) {
      toast(`Only ${room} more image${room === 1 ? '' : 's'} can be added (max 5).`, true);
      return;
    }
    try {
      const saved = await API.upload(`/api/products/${productId}/images/upload`, files);
      images.push(...saved);
      renderImages();
      toast(`${saved.length} image${saved.length === 1 ? '' : 's'} uploaded.`);
    } catch (err) { fail(err); }
  };

  view.querySelector('#spec-save').onclick = async () => {
    alertBox.innerHTML = '';
    try {
      let saved = 0;
      for (const id of removedIds) {
        await API.del(`/api/products/${productId}/specifications/${id}`);
        saved++;
      }
      removedIds.length = 0;
      for (const s of specs) {
        if (!s.title.trim() || !s.spec.trim()) continue;
        if (s.id) await API.put(`/api/products/${productId}/specifications/${s.id}`, { title: s.title.trim(), spec: s.spec.trim() });
        else {
          const created = await API.post(`/api/products/${productId}/specifications`, { title: s.title.trim(), spec: s.spec.trim() });
          s.id = created.product_specification_id;
        }
        saved++;
      }
      toast(`Specifications saved (${saved} change${saved === 1 ? '' : 's'}).`);
    } catch (err) { fail(err); }
  };
}

/* ---------------- vendor: categories ---------------- */

async function viewVendorCategories(view) {
  view.innerHTML = `
    <div class="page-head">
      <div><h3>Categories</h3><p>Shared catalog categories — products pick one from a dropdown.</p></div>
      <button id="new-cat" class="btn btn-primary">＋ Add category</button>
    </div>
    <div class="card">
      <div class="table-wrap"><table>
        <tr><th>Category</th><th style="width:180px">Actions</th></tr>
        <tbody id="cat-rows"></tbody>
      </table></div>
    </div>
    <form id="cat-form" class="card hidden" style="max-width:420px">
      <h3 id="cf-title">Add category</h3>
      <label>Category name <input name="category" required /></label>
      <div style="display:flex;gap:8px" class="mt">
        <button class="btn btn-primary" type="submit">Save</button>
        <button class="btn btn-ghost" type="button" id="cf-cancel">Cancel</button>
      </div>
    </form>`;

  const rows = view.querySelector('#cat-rows');
  const form = view.querySelector('#cat-form');
  let editingId = null;

  async function render() {
    const cats = await API.get('/api/categories');
    rows.innerHTML = cats.length
      ? cats
          .map(
            (c) => `
        <tr>
          <td>${esc(c.category)}</td>
          <td><div class="actions-cell">
            <button class="btn btn-ghost btn-sm" data-edit="${c.category_id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-del="${c.category_id}">Delete</button>
          </div></td>
        </tr>`
          )
          .join('')
      : '<tr><td colspan="2"><div class="empty">No categories yet.</div></td></tr>';

    rows.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => {
        const c = cats.find((x) => x.category_id === Number(b.dataset.edit));
        editingId = c.category_id;
        view.querySelector('#cf-title').textContent = 'Edit category';
        form.category.value = c.category;
        form.classList.remove('hidden');
      };
    });
    rows.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!confirmDialog('Delete this category?')) return;
        try {
          await API.del('/api/categories/' + b.dataset.del);
          invalidateCategories();
          toast('Category deleted.');
          render();
        } catch (err) {
          toast(err.message, true);
        }
      };
    });
  }

  view.querySelector('#new-cat').onclick = () => {
    editingId = null;
    view.querySelector('#cf-title').textContent = 'Add category';
    form.reset();
    form.classList.remove('hidden');
  };
  view.querySelector('#cf-cancel').onclick = () => form.classList.add('hidden');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      if (editingId) await API.put('/api/categories/' + editingId, { category: fd.get('category') });
      else await API.post('/api/categories', { category: fd.get('category') });
      invalidateCategories();
      toast('Category saved.');
      form.classList.add('hidden');
      render();
    } catch (err) {
      toast(err.message, true);
    }
  });

  await render();
}

/* ---------------- vendor: orders ---------------- */

// Manual per-item delivery editing stops at "out for delivery" — only the
// buyer's OTP (Confirm delivery) marks an item truly delivered.
const DELIVERY_STATES = ['pending', 'confirmed', 'processing', 'packed', 'shipped', 'out_for_delivery', 'cancelled', 'returned', 'failed'];

async function viewVendorOrders(view) {
  const orders = await API.get('/api/orders/vendor');
  if (!orders.length) {
    view.innerHTML = `<div class="card"><div class="empty">No orders received yet.</div></div>`;
    return;
  }
  view.innerHTML =
    `<div class="page-head"><div><h3>Orders received</h3><p>Orders that include your products. Update status or leave a note for the buyer.</p></div></div>` +
    orders
      .map(
        (o) => `
    <div class="card" data-order="${o.order_id}">
      <div class="page-head">
        <div>
          <h3>Order #${o.order_id} ${statusChip(o.status)}</h3>
          <p>Customer: ${esc(o.customer_name)} · Placed ${fmtDate(o.created_at)}</p>
        </div>
        <div style="font-size:18px;font-weight:700">${money(o.total_amount)}</div>
      </div>
      <div class="table-wrap"><table>
        <tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Total</th><th>Delivery</th></tr>
        ${o.items
          .map(
            (it) => `<tr>
          <td>${esc(it.product_name)}</td>
          <td>${it.quantity}</td>
          <td>${money(it.unit_price)}</td>
          <td>${money(it.total_price)}</td>
          <td class="delivery-editor" data-item="${it.order_item_id}">
            <select data-dstatus="${it.order_item_id}" aria-label="Delivery status">
              ${DELIVERY_STATES.map((s) => `<option value="${s}" ${s === (it.delivery_status || 'pending') ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
            <input data-track="${it.order_item_id}" placeholder="Tracking #" value="${esc(it.tracking_number || '')}" />
            <input data-courier="${it.order_item_id}" placeholder="Courier" value="${esc(it.courier_name || '')}" />
            <input type="date" data-eta="${it.order_item_id}" aria-label="Expected delivery" value="${it.expected_delivery_date ? String(it.expected_delivery_date).slice(0, 10) : ''}" />
          </td>
        </tr>`
          )
          .join('')}
      </table></div>
      <div class="kv mt">
        <div class="k">Ship to</div>
        <div>${esc(o.address_line_1 || '')}${o.address_line_2 ? ', ' + esc(o.address_line_2) : ''}, ${esc(o.city || '')}, ${esc(o.state || '')} — ${esc(o.pincode || '')}</div>
      </div>
      <div class="mt" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <select data-status="${o.order_id}" style="width:auto">
          ${['pending', 'confirmed', 'shipped', 'out_for_delivery', 'cancelled']
            .map((s) => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`)
            .join('')}
        </select>
        <input data-note="${o.order_id}" placeholder="Note to buyer…" value="${esc(o.vendor_note || '')}" style="max-width:280px" />
        <button class="btn btn-outline btn-sm" data-save="${o.order_id}">Save</button>
      </div>
    </div>`
      )
      .join('');

  view.querySelectorAll('[data-save]').forEach((btn) => {
    btn.onclick = async () => {
      const oid = btn.dataset.save;
      const card = view.querySelector(`[data-order="${oid}"]`);
      const status = card.querySelector('[data-status]').value;
      const note = card.querySelector('[data-note]').value;
      try {
        if (status === 'cancelled') {
          await API.put(`/api/orders/${oid}/cancel`, {});
        } else {
          await API.put(`/api/orders/${oid}/status`, { status });
        }
        await API.put(`/api/orders/${oid}/note`, { vendor_note: note });
        const order = orders.find((o) => o.order_id === Number(oid));
        for (const it of status === 'cancelled' ? [] : (order ? order.items : [])) {
          const delivery = {
            status: card.querySelector(`[data-dstatus="${it.order_item_id}"]`).value,
            tracking_number: card.querySelector(`[data-track="${it.order_item_id}"]`).value.trim(),
            courier_name: card.querySelector(`[data-courier="${it.order_item_id}"]`).value.trim(),
            expected_delivery_date: card.querySelector(`[data-eta="${it.order_item_id}"]`).value || null,
          };
          const changed =
            delivery.status !== (it.delivery_status || 'pending') ||
            delivery.tracking_number !== (it.tracking_number || '') ||
            delivery.courier_name !== (it.courier_name || '') ||
            delivery.expected_delivery_date !== (it.expected_delivery_date || null);
          if (changed) {
            await API.put(`/api/orders/${oid}/items/${it.order_item_id}/delivery`, delivery);
          }
        }
        toast(`Order #${oid} updated.`);
        viewVendorOrders(view);
      } catch (err) {
        toast(err.message, true);
      }
    };
  });
}

/* small debounce helper */
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
