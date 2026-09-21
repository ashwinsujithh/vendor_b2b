# StorePanel — Database Map

Live connection settings come from `.env` (loaded by `src/config/db.js`):

| Setting | Value |
|---|---|
| Server | MariaDB (XAMPP) at `localhost:3306` |
| Database | **`storepanel`** |
| User / Password | `root` / *(empty — XAMPP default)* |
| phpMyAdmin | <http://localhost/phpmyadmin> → pick **storepanel** |

Seeding: `node seed.js` (fresh install) · Full reset: `node scripts/reset-demo-data.js --yes` (wipes everything except `user` + `subscription`, rebuilds the 40-product catalog).

---

## 1. Accounts (table `user`) — password for ALL: `demo1234`

| user_id | Name | Email | Role | Verified client of (vendor_client) | Plan (FK → subscription) | Plan window |
|---|---|---|---|---|---|---|
| 1 | **Sundar Traders** | `sundar.traders@gmail.com` | Vendor | — | Gold (2) | valid |
| 2 | **Meera Krishnan** | `meera.krishnan@gmail.com` | Client | Sundar Traders (1), FreshMart (4) | — (plan bought, not started) | — |
| 3 | **Sam Mathew** | `sam.mathew@gmail.com` | Client | Sundar Traders (1) | — | — |
| 4 | **FreshMart Supermarket** | `freshmart.india@gmail.com` | Vendor | — | Gold (2) | valid |
| 5 | **TechNest Electronics** | `technest.store@gmail.com` | Vendor | — | Silver (1) | valid |
| 6 | **StyleHub Fashion** | `stylehub.fashion@gmail.com` | Vendor | — | Premium (3) | valid |
| 7 | **Aarav Sharma** | `aarav.sharma@gmail.com` | Client | FreshMart (4) | — | — |
| 8 | **Diya Patel** | `diya.patel@gmail.com` | Client | FreshMart (4) | — | — |
| 9 | **Rohan Nair** | `rohan.nair@gmail.com` | Client | TechNest (5) | — | — |

*Vendor powers = `is_vendor`: `is_active = 1` (admin toggle) **and** an active plan whose window has started. Clients see and buy from **every vendor in their verified `vendor_client` pairs** — a vendor can have many clients and a client can be linked to many vendors (added by mobile + OTP).*

**`user.is_active` is a boolean** — `1` = enabled (login allowed), `0` = admin-disabled. Subscription (`subscription_id` + validity window) alone decides vendor entitlement; `is_active` is purely the admin kill switch. Vendor-created clients are created at `1` when their invite is verified by OTP; admins toggle accounts by setting this field directly in the DB (admin dashboard comes later). Login/API both refuse accounts with `is_active = 0`.

**Single session per account:** each login stores a session id hash in `user.session_token` and embeds it in the JWT — logging in on another device (or logout) invalidates the previous token, which then gets `401 "You have been signed out — your account was logged in on another device."`

**Where it shows:** login page · profile avatar/name · vendor name on every product card · "From \<customer\>" on vendor order requests · Clients page (this vendor's client pairs from `vendor_client`).

## 2. Subscription plans (table `subscription`)

| subscription_id | plan | clients | products | price | validity_days |
|---|---|---|---|---|---|
| 1 | Silver | 5 | 10 | ₹499 | 30 |
| 2 | Gold | 20 | 50 | ₹999 | 30 |
| 3 | Premium | 100 | 200 | ₹1,999 | 60 |
| 4 | Enterprise | 1000 | 1000 | ₹4,999 | 90 |

**Where it shows:** Subscription Plans page (`#/plans`) — active-plan banner + upgrade cards; plan-limit hint on My Products ("X of Y products used").

## 3. Categories (table `category`)

`1 Electronics` · `2 Groceries & Food` · `3 Fashion` · `4 Home & Kitchen` · `5 Books & Stationery` · `6 Sports & Fitness`

**Where it shows:** home category chips · Categories page (`#/shop`) · category dropdown in product forms · vendor Categories page (CRUD).

## 4. Products (table `product`) — 40 rows, 10 per vendor

| vendor | products (sample) |
|---|---|
| Sundar Traders (1) | Wireless Mouse ₹499 (1 nos, stock 25), Whole Wheat Atta 5kg ₹620, Denim Jeans ₹1,299, Smart LED Bulb ₹249, The Alchemist ₹299, Resistance Bands ₹599… |
| FreshMart Supermarket (4) | Bluetooth Headphones ₹1,499, Almonds 250g ₹340, Casual Sneakers ₹1,799, Power Bank ₹999, Electric Kettle ₹949, Football ₹749… |
| TechNest Electronics (5) | USB-C Charger ₹649, Yoga Mat ₹899, Wireless Keyboard ₹899, Masala Chai ₹260, Silk Scarf ₹649, Skipping Rope ₹199… |
| StyleHub Fashion (6) | Organic Green Tea ₹299, Running Shoes ₹2,199, Leather Wallet ₹799, Honey ₹450, HDMI Cable ₹199, Dumbbell Set ₹1,899… |

All 40 with free-text qty/unit (`1 nos`, `200 gram`, `5kg`, `1 litre`, `3 nos`, `1 pair`, `1.5 metre`…); a few low-stock (6–9 units) to show the red state.

**Where it shows:** home Featured Products (others' products only — a vendor never sees their own here) · category pages & search · product detail page · vendor **My Products** list (own products, edit/delete) · vendor Categories page links.

## 5. Product media & specs

- **`product_image`** — 80 rows: 2 per product, generated SVG files in `public/uploads/products/` (paths like `/uploads/products/demo-*.svg`), first = cover (`is_primary=1`).
  *Shows:* product card thumbnails, detail-page image slider, catalog thumbs.
- **`product_specification`** — 80 rows: 2 per product (e.g. Wireless Mouse → `Connectivity: 2.4GHz USB receiver`, `Battery: 1 × AA (included)`).
  *Shows:* product detail "Specifications" list, shop-card spec chips, vendor product-edit spec editor.

## 6. Shopping & orders (currently empty — populated as you use the app)

| Table | Purpose | Shows in |
|---|---|---|
| `address` | User delivery addresses (FK user) | Manage Addresses page; cart address picker |
| `cart` | Cart lines (FK user + product, unique per pair) | Cart page; nav badge count |
| `checkout` | One checkout group per purchase (FK user) | — (internal grouping) |
| `order` | One row per vendor per checkout: total, status, `delivery_otp`, `stock_deducted` (stock moves only when the vendor confirms — restored on cancel), vendor_note (FKs checkout, user=buyer, user=vendor, address) | My Orders; Order Requests; shipment/track pages; confirmation |
| `order_item` | Per-product lines with name/qty/price snapshot (FKs order, product, user=vendor) | Order cards' item lists; shipment items |
| `delivery_status` | Per-item tracking: status, tracking #, courier, shipped/ETA/delivered, note (FKs order, order_item, product, user=vendor) | Track Order page; shipment progress; vendor delivery editor |
| `client_verification` | OTP codes for vendor-created clients (FKs user×2) | Clients page OTP flow |

## 7. Foreign-key graph (verified live from `information_schema`)

```
subscription ──< user.subscription_id          (plan → account)
user(vendor) ──< vendor_client.vendor_id ──> user(client) via vendor_client.client_id
              (many vendors ↔ many clients; a pending invite has client_id NULL + staged_reg_phone — the mobile only, since name/email are collected after OTP verification)
user ──< address.user_id
user ──< cart.user_id            product ──< cart.product_id
user ──< checkout.user_id
checkout ──< order.checkout_id
user(buyer) ──< order.user_id
user(vendor) ──< order.vendor_id
address ──< order.address_id
order ──< order_item.order_id
product ──< order_item.product_id
user(vendor) ──< order_item.vendor_id
order ──< delivery_status.order_id
order_item ──< delivery_status.order_item_id   (unique — 1 tracking row per item)
product ──< delivery_status.product_id
user(vendor) ──< delivery_status.vendor_id
product ──< product_image.product_id
product ──< product_specification.product_id
user(client) ──< client_verification.client_id
user(vendor) ──< client_verification.vendor_id
user(vendor) ──< product.vendor_id
category ──< product.category_id
```

**Key delete rules (CASCADE = child rows auto-removed):** deleting a user cascades their addresses/cart/clients; deleting a product cascades its images, specs, cart lines (uploaded files are unlinked from disk by the API); `order.*` FKs are RESTRICT — orders block user/product deletion to preserve purchase history; `delivery_status` cascades from both `order` and `order_item`; images/specs cascade with the product.

## 8. Current row counts

user **9** · subscription **4** · category **6** · product **40** · product_image **80** · product_specification **80** · address **0** · cart **0** · checkout **0** · `order` **0** · order_item **0** · delivery_status **0** · client_verification **0**

*Order tables fill automatically when a customer logs in, adds to cart, and checks out — the full chain (checkout → order → order_item → delivery_status) is created by `POST /api/checkout` with an OTP per order.*
