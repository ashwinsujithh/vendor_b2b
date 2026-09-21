# VendorHub (StorePanel) — Full Software Specification

**Version:** 1.0 · **Date:** 2026-09-21 · **Stack:** Node.js + Express + MySQL (server-rendered SPA frontend, no build step)

A multi-vendor commerce panel where **vendors sell only to their own invited clients**. Accounts are provisioned by vendors (mobile + OTP); buying a subscription plan turns a customer into a vendor. Covers auth, catalog, cart, multi-vendor checkout, orders, per-item delivery tracking, OTP handover, and plan-limit enforcement.

---

## 1. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Runtime | Node.js (≥ 18) | `node --watch` for dev |
| HTTP framework | Express 4 | Single `server.js` entry |
| Database | MySQL 8 / InnoDB, utf8mb4 | Accessed via `mysql2/promise` connection pool (limit 10, `dateStrings: true`) |
| Auth | JWT (`jsonwebtoken`, 7-day expiry) + bcryptjs password hashing | Single-session enforcement via hashed session id |
| Uploads | Multer 2 (disk storage) | Images to `public/uploads/products` |
| Frontend | Vanilla JS SPA (hash router), no framework, no bundler | ES2020, served as static files |
| Styling | Single hand-written CSS file, CSS custom properties | Two accent themes, mobile-first |
| Config | dotenv (`.env`) | Port, DB credentials, JWT secret |
| Tests | Node built-in test runner (`node:test`) | 31 source-contract tests + isolated E2E |

**No** frontend framework, transpiler, CSS framework, ORM, redis, or external services. Everything runs in one process.

---

## 2. Architecture

```
┌────────────────────────── Browser (SPA) ──────────────────────────┐
│ public/index.html      → login page  (auth.js)                    │
│ public/dashboard.html  → app shell   (app.js + views.js + ui.js)  │
│ public/js/api.js       → fetch wrapper, JWT bearer, 401 handling  │
│ Hash router (#/route/param) → view function renders into #view    │
└───────────────┬───────────────────────────────────────────────────┘
                │ JSON  { success: boolean, message?, data }
┌───────────────▼───────────── Express (server.js) ─────────────────┐
│ express.json() · express.static(public)                           │
│ /api/auth /api /api/subscriptions /api/categories /api/products   │
│ /api/clients /api/cart /api/checkout /api/orders /api/dashboard   │
│ src/middleware/auth.js → authRequired / authOptional /requireVendor│
│ src/utils/http.js → HttpError + wrap (uniform error envelope)     │
└───────────────┬───────────────────────────────────────────────────┘
┌───────────────▼─────────── MySQL: storepanel ─────────────────────┐
│ 13 tables (§4) · schema.sql creates DB + seed plans/categories    │
└───────────────────────────────────────────────────────────────────┘
```

- **Response envelope:** every endpoint returns `{ success: true, data }` or `{ success: false, message }` with a proper HTTP status (400/401/403/404/429/500).
- **Error handling:** async handlers are wrapped in `wrap()`; thrown `HttpError(status, message)` becomes the JSON envelope. A global Express error handler catches the rest (500).
- **Static assets:** `/css/styles.css`, `/js/*.js`, `/uploads/products/*` served from `public/`. HTML pages use version-query cache busting (`?v=YYYYMMDD-tag`).

---

## 3. Frontend Specification

### 3.1 Pages
| Page | File | Purpose |
|---|---|---|
| Sign-in | `public/index.html` + `js/auth.js` | Login-only (no self-registration). Shows a "Continue as…" session banner when a token exists. |
| App shell | `public/dashboard.html` | Sidebar (desktop ≥769px), bottom tab bar (mobile ≤768px), topbar, toast, single `#view` container. |

### 3.2 Client modules (`public/js/`)
| Module | Responsibilities |
|---|---|
| `api.js` | `API.get/post/put/del/postForm/upload`. Injects `Authorization: Bearer <token>` from `localStorage.token`. On 401 (non-login): clears token, stores the server reason in `session_message`, redirects to `/`. |
| `ui.js` | `esc()` HTML-escaping, `money()` (₹, en-IN), `toast()` (3.5 s, error variant), `confirmDialog()`, `fmtDate()`, `progressBar()`, `statusChip()` (maps all 10 delivery states to colored chips). |
| `app.js` | Theme persistence (`localStorage.theme`, `data-theme` attr), sidebar + mobile bottom-nav rendering (vendor tab swap), hash router with route table, views: Dashboard (storefront with category chips, live search, horizontal product strips), Profile (edit form, subscription card, address manager), Addresses (modal form CRUD), Plans (purchase), Settings (accent theme), Vendor Clients (invite → OTP → details flow). |
| `views.js` | Shop (category browser → filtered results with sort), Product detail (5-image swipe slider, qty stepper, add-to-cart), Cart (qty steppers, per-item remove, address selection, checkout), Confirmation (order meta, delivery OTP card, item summary), Orders (tabs/filters, list cards), Shipment status (5-step pipeline), Tracking (map, courier, per-item delivery data), Vendor Products (catalog + low-stock alert + plan hint), Product Add/Edit (multipart create with up to 5 images + spec rows; row-by-row spec editing), Vendor Categories (table CRUD), Vendor Orders (per-item delivery editor, status, buyer note, delivery OTP verify). |

### 3.3 Routing (hash-based)
`#/dashboard` (default) · `#/shop`, `#/shop/:categoryId` · `#/product/:id` · `#/cart` · `#/orders` · `#/order/:id` · `#/tracking/:id` · `#/confirmation/:ids` · `#/plans` · `#/profile` · `#/addresses` · `#/settings` · `#/vendor/products` · `#/product-new` · `#/product-edit/:id` · `#/vendor/clients` · `#/vendor/categories` · `#/vendor/orders`

Vendor routes redirect non-vendors to `#/plans` with a toast.

### 3.4 Design system
- **Tokens (CSS custom properties):** `--bg #f4f6fb`, `--panel #fff`, `--border #e3e8f0`, `--text #1f2937`, `--muted #6b7280`, `--radius 12px`, and an accent set `--accent / --accent-dark / --accent-soft` aliased to `--primary*`.
- **Themes:** `green` (default `#159b69`) and `violet` (`#6d3fe9`), switched on Settings; every accent consumer follows the theme.
- **Status colors:** green `#059669`, red `#dc2626`, amber `#d97706`, blue `#2563eb` (each with a `-soft` background variant).
- **Core components:** `.btn` (primary / outline / danger / ghost / sm / block), `.card`, `.chip` (+ green/red/amber), `.alert`, `.toast`, `.modal-overlay/.modal-card`, `.table-wrap`, `.grid .grid-2/3/4`, `.empty`, `.kv`, `.progress`.
- **Breakpoints:** ≤900px (grid collapse), ≤768px (mobile app layout: sidebar hidden, bottom nav, 44px touch targets, 16px inputs to prevent iOS zoom), ≤520px (single column).
- **Desktop (≥769px):** centered content columns (cart 720px, profile/addresses/plans 640px, search 900px, shipment/tracking 760px), in-flow cart summary card, multi-column lists, product page as one composed card.
- **All state changes give feedback** via toasts; destructive actions use `confirm()`.

---

## 4. Data Model (MySQL: `storepanel`)

13 tables. Common audit columns: `created_at`, `created_by`, `updated_at`, `updated_by`.

| Table | Purpose | Key columns & constraints |
|---|---|---|
| `subscription` | Plan catalog | `plan`, `number_of_clients`, `number_of_products`, `price`, `validity_days`. Seeded: Silver (5/10/₹499/30d), Gold (20/50/₹999/30d), Premium (100/200/₹1999/60d), Enterprise (1000/1000/₹4999/90d) |
| `user` | Accounts | `reg_phone` (unique, identity), `email` (unique, optional), `password_hash`, `session_token CHAR(64)` (sha256 of active session), `is_active TINYINT(1)` (admin kill switch), `subscription_id` FK, `sub_valid_from/to` |
| `address` | User addresses | FK → user (CASCADE). line1/2, city, state, country, pincode |
| `category` | Shared catalog categories | `category` UNIQUE |
| `product` | Vendor products | FK vendor → user (CASCADE), FK category (RESTRICT). `quantity` (pack size text), `selling_price`, `stock_quantity` |
| `product_image` | Product images | FK → product CASCADE. `image_url` (served path), `is_primary`, `sort_order`. Max 5 per product (enforced in API) |
| `product_specification` | Title/value pairs | FK → product CASCADE |
| `cart` | Cart lines | UNIQUE (user_id, product_id), `quantity` |
| `checkout` | Checkout grouping | FK → user. One checkout → many orders |
| `order` | One **per vendor** per checkout | FKs: checkout (RESTRICT), user (RESTRICT), vendor → user (RESTRICT), address (RESTRICT). `status`, `delivery_otp`, `stock_deducted` flag, `vendor_note` |
| `order_item` | Line items (denormalized `product_name`, `unit_price`, `total_price`) | FKs: order CASCADE, product RESTRICT, vendor RESTRICT |
| `delivery_status` | Per-item tracking | UNIQUE (order_item_id). 10-state `status`, `tracking_number`, `courier_name`, `shipped_at`, `expected_delivery_date`, `delivered_at`, `delivery_note` |
| `vendor_client` | Vendor ↔ client link | UNIQUE (vendor_id, client_id); UNIQUE (vendor_id, staged_reg_phone). `status`: 0 = pending, 1 = verified. `client_id NULL` + `staged_reg_phone` = invite not yet an account |
| `client_verification` | Invite OTPs | FK → vendor_client CASCADE. `otp_hash CHAR(64)` (sha256), `expires_at` (+10 min), `attempt_count` (max 5) |

**ER summary:** `subscription 1—* user` · `user 1—* address` · `user 1—* product (vendor)` · `category 1—* product` · `product 1—* product_image / product_specification` · `user 1—1 cart—product *—1` · `checkout 1—* order 1—* order_item 1—1 delivery_status` · `vendor 1—* vendor_client *—1 client(user) 1—* client_verification`.

---

## 5. Authentication & Sessions

- **Login:** `POST /api/auth/login` with `email` (accepts email **or** 10-digit mobile) + `password`. bcrypt verify → `createSession()` generates a 32-byte random session id, stores **sha256(session id)** in `user.session_token`, returns JWT `{ user_id, sid }` (7-day expiry). Response includes the user object + `token`.
- **Single-session rule:** every request re-verifies `payload.sid === user.session_token` (DB lookup). A login on another device replaces the stored hash → older tokens die with *"signed in on another device"*. Logout nulls the token.
- **Kill switch:** `is_active = 0` (set directly in DB) blocks all sessions with *"Account disabled"*.
- **JWT secret:** `JWT_SECRET` env (dev fallback `dev-secret-change-me`).
- **Token storage (client):** `localStorage.token`; 401 → wipe + redirect to `/` carrying the reason via `localStorage.session_message`.
- **Role derivation:** `is_vendor = is_active=1 AND subscription covers today`. `vendor_ids` = ids of vendors this account is a **verified client** of — drives product visibility and checkout.

**No public registration.** Accounts are created either by vendor client-invites (mobile OTP → account auto-created if the number is unknown) or by purchasing a plan (needs an existing login).

---

## 6. Roles & Permissions

| Capability | Customer | Vendor |
|---|---|---|
| Browse products | Only of their verified vendors | All (own + other vendors they buy from) |
| Cart / checkout / orders | ✅ | ✅ |
| Buy/renew subscription | ✅ (becomes vendor) | ✅ (upgrade/renew) |
| Product / category / clients / vendor orders CRUD | ❌ 403 | ✅ (`requireVendor`) |
| Update order status / delivery data | ❌ | Own orders only |
| Confirm delivery | Shares OTP | Enters OTP (only path to `completed`) |

Vendor state requires **`is_active=1` + active plan window** — an expired plan silently downgrades the account to customer.

---

## 7. API Reference

All routes prefixed `/api`. JSON body in/out; `Authorization: Bearer <jwt>` required unless noted. Envelope: `{ success, message?, data }`.

### Auth — `/api/auth`
| Method & path | Access | Description |
|---|---|---|
| `POST /login` | public | Email-or-mobile + password → `{ token, user }` (also issues a new session) |
| `GET /me` | any | Current user + plan + `is_vendor` + `vendor_ids` |
| `POST /logout` | any | Destroys session server-side |

### Profile & addresses — `/api`
| Method & path | Access | Description |
|---|---|---|
| `GET /profile` · `PUT /profile` | any | View / update `name`, `alt_phone`, `email` |
| `GET /addresses` · `POST /addresses` | any | List / create (line1 required; line2, city, state, country default "India", pincode) |
| `PUT /addresses/:id` · `DELETE /addresses/:id` | any | Update / delete **own** address |

### Subscriptions — `/api/subscriptions`
| Method & path | Access | Description |
|---|---|---|
| `GET /` | any | Plan list |
| `POST /purchase` | any | `{ subscription_id }` → sets plan + validity window (renew = extend from today; upgrade = immediate) → caller becomes vendor. Returns updated user |

### Categories — `/api/categories`
| Method & path | Access | Description |
|---|---|---|
| `GET /` | any | All categories (dropdowns) |
| `GET /fuzzy?q=` | vendor | Nearest existing category for a typed name (used by Add-Product live matching) |
| `POST /` · `PUT /:id` · `DELETE /:id` | vendor | CRUD (unique names) |

### Products — `/api/products`
| Method & path | Access | Description |
|---|---|---|
| `GET /?q=&category_id=` | optional auth | Browse (client-visibility filtered when logged in). Returns products with images + specifications |
| `GET /:id` | optional auth | Product detail (visibility filtered) |
| `GET /mine` | vendor | Own catalog incl. ordered quantities |
| `POST /` | vendor | JSON create `{ product, category_id?, new_category?, description?, quantity?, selling_price, stock_quantity? }`. Enforces plan product limit. `new_category` fuzzy-joins an existing category or creates one |
| `PUT /:id` · `DELETE /:id` | vendor owner | Update / delete own product |
| `POST /create-with-assets` | vendor | Multipart: product fields + `new_category` + `images[]` (≤5, 5 MB each, JPEG/PNG/WEBP/GIF/AVIF) + `specifications` (JSON string). One-shot create |
| `GET/POST /:id/images` | vendor owner | List / insert image records |
| `POST /:id/images/upload` | vendor owner | Multipart `images[]` → files on disk + DB rows (max 5 total) |
| `DELETE /:id/images/:imageId` | vendor owner | Remove row (+ disk file) |
| `GET/POST /:id/specifications` · `PUT/DELETE /:id/specifications/:sid` | vendor owner | Row-by-row spec CRUD |

### Clients — `/api/clients` (vendor only)
| Method & path | Description |
|---|---|
| `GET /` | Client list (linked + staged invites, verification status) |
| `POST /` | `{ reg_phone }` → stage invite for the mobile number (never reveals whether the number has an account); returns `{ pair_id, demo_otp }` |
| `PUT /:pairId` | Edit client name / email / phones |
| `POST /:pairId/send-otp` | Issue a new OTP (10-min expiry, 5 attempts) |
| `POST /:pairId/verify` | `{ code }` → verifies; **resolves existence**: known account → linked (`existing_account`); unknown number → account auto-created (bcrypt demo password) → `needs_details` (client then submits name/email/address) |
| `POST /:pairId/address` | Post-verify address capture for new clients |
| `DELETE /:pairId` | Unlink client |

### Cart — `/api/cart`
| Method & path | Description |
|---|---|
| `GET /` | Items + product info + `total` |
| `POST /` | `{ product_id, quantity }` — must be a verified client of the vendor; caps at stock; upserts the line |
| `PUT /:id` · `DELETE /:id` | Change quantity (stock-capped) / remove **own** line |

### Checkout — `POST /api/checkout`
`{ address_id }` → single DB transaction:
1. Load cart lines (400 if empty) · verify client-visibility per line (403 otherwise) · verify stock per line (400 otherwise)
2. Group by vendor; for each vendor enforce `number_of_clients` — **new clients only** (existing buyers exempt; expired plan = no enforcement)
3. Validate the address belongs to the buyer
4. Insert 1 `checkout` → N `order` rows (one per vendor, `status='pending'`, shared `delivery_otp`) → `order_item` rows → clear cart. **Stock is NOT deducted here**
→ `{ order_ids: [...] }`

### Orders — `/api/orders`
| Method & path | Access | Description |
|---|---|---|
| `GET /` | any | Buyer's orders with items + delivery records + vendor dispatch address |
| `GET /vendor` | vendor | Orders received (own purchases excluded) |
| `PUT /:id/status` | vendor owner | `{ status }` limited to `pending | confirmed | shipped | out_for_delivery | cancelled`. First non-cancelled transition **deducts stock once** (`stock_deducted` flag) |
| `PUT /:id/cancel` | vendor owner | Cancel + **restore stock** if it was deducted; sets item-level `cancelled` |
| `PUT /:id/note` | vendor owner | `{ vendor_note }` visible to the buyer |
| `PUT /:id/items/:itemId/delivery` | vendor owner | Per-item: 10-state `status`, `tracking_number`, `courier_name`, `expected_delivery_date`; sets `shipped_at` on shipped; `delivered` is **rejected** (OTP-only) |
| `PUT /:id/verify-delivery` | vendor owner | `{ otp }` — correct buyer OTP marks order `completed` and items `delivered` (`delivered_at`); wrong/expired → 4xx |

### Dashboard — `GET /api/dashboard`
Role-aware stats: `product_count` / `product_limit`, client count / limit, low-stock list (≤5 units), subscription summary.

### Health — `GET /api/health` (public) → `{ status: 'ok' }`

---

## 8. Business Rules (enforced server-side)

1. **Client-only commerce** — a user sees and can order **only** from vendors who added them as a verified client (`vendor_client.status = 1`). Enforced in product listing, detail, cart-add, and checkout.
2. **Plan product limit** — vendors cannot create beyond `subscription.number_of_products` (403 with upgrade hint).
3. **Plan client limit** — a vendor's `number_of_clients` caps **new** buyers at checkout; existing buyers are exempt; expired plans don't enforce.
4. **Category integrity** — `category_id` must exist; typed names are fuzzy-matched to existing categories before creating new ones (title-cased).
5. **Stock discipline** — cart caps at stock; checkout validates stock; stock decrements **once** when the vendor first confirms (`stock_deducted` idempotency flag) and restores on cancel.
6. **Multi-vendor split** — one checkout creates one order per vendor, atomically, in a single transaction; cart cleared in the same transaction.
7. **OTP delivery handover** — `completed`/`delivered` can never be set manually; only the buyer's 6-digit OTP (currently a fixed demo `123456`) via `verify-delivery`.
8. **Client OTP lifecycle** — invite OTP: sha256-stored, 10-minute expiry, max 5 attempts (429 afterwards); existence of an account is only revealed at verify.
9. **Ownership everywhere** — every mutation scopes by `user_id`/`vendor_id`; IDs from other accounts 404/403.
10. **Single session per account** — newest login wins.

---

## 9. Delivery Lifecycle

**Order status:** `pending → confirmed → shipped → out_for_delivery → completed(OTP)` with `cancelled` branch. (5-step buyer pipeline: Order Placed / Packed / Shipped / Out for Delivery / Delivered.)

**Per-item `delivery_status` (10 states):** `pending, confirmed, processing, packed, shipped, out_for_delivery, delivered, cancelled, returned, failed` — `delivered`/`completed` are OTP-only; manual editing covers the rest. UI chips color-code every state (`ui.js statusChip`).

---

## 10. Uploads & Static Assets

- Destination: `public/uploads/products/` · filename: `{timestamp}-{12-hex}{ext}` · hard cap 5 MB/file, 5 files/product, MIME whitelist JPEG/PNG/WEBP/GIF/AVIF.
- `product_image.image_url` stores the served path (`/uploads/products/<file>`); delete endpoint removes row **and** file; failed creates clean up temp files.
- Demo tooling may add generated SVGs (prefixed `demo-*`) — `scripts/fix-demo-images.js` rewrites them in place without touching the DB.

---

## 11. Configuration (`.env`)

| Key | Default | Purpose |
|---|---|---|
| `PORT` | `3002` | HTTP port |
| `DB_HOST` / `DB_PORT` | `localhost` / `3306` | MySQL connection |
| `DB_USER` / `DB_PASSWORD` | `root` / — | Credentials |
| `DB_NAME` | `storepanel` | Database (schema.sql creates it) |
| `JWT_SECRET` | `dev-secret-change-me` | **Set a long random value in production** |

---

## 12. Scripts & Commands

| Command | What it does |
|---|---|
| `npm start` | Start server (http://localhost:3002) |
| `npm run dev` | Start with `node --watch` |
| `npm test` | 31 source-contract tests (fast, no DB) |
| `node test/e2e.js` | Full E2E: creates throwaway DB `storepanel_e2e`, loads schema + seed, boots on :3100, runs all flows, drops DB |
| `npm run seed` | `node seed.js` — demo vendor/user/order/cart into existing DB |
| `node scripts/reset-demo-data.js [--yes]` | Wipe transactional tables (keeps user/subscription), regenerate categories/products/demo images |
| `node scripts/fix-demo-images.js [--yes]` | Rewrite demo SVGs in place (no DB changes) |

**Setup:** `npm install` → `cp .env.example .env` (edit) → `mysql -u root -p < schema.sql` → optionally `npm run seed` → `npm start`.

**Demo accounts (after seed):** `sundar.traders@gmail.com`, `freshmart.india@gmail.com`, `technest.store@gmail.com`, `meera.krishnan@gmail.com` — all `demo1234`.

---

## 13. Testing Strategy

- **`test/api.test.js`** (31 tests, `node --test`): loads actual source files and asserts the **contract**: auth/session behavior (401 → token cleared, redirect), schema invariants (delivery_status table, session_token, is_active, vendor_client staging), route shapes (all endpoint paths), OTP-only delivered/completed enforcement, product visibility SQL, UI structure (routes, storefront, cart, mobile nav), and status-chip coverage. Guards against regressions in security-critical logic.
- **`test/e2e.js`**: isolated end-to-end smoke test — spins a private DB + server, exercises real flows, cleans up. Dev DB and running server are never touched.

---

## 14. Known Limitations / Production Checklist

- **OTP is a demo constant** (`123456`) — integrate a real SMS provider; same for client-invite OTP (flow is real, delivery is not).
- **No payments** — "purchase" activates plans instantly; no gateway integration.
- **Promo codes** — removed from the cart UI as non-functional; backend support absent.
- **Admin tooling** — `is_active` is a DB-level kill switch; there is no admin UI/role.
- **HTML caching** — express.static sends no `Cache-Control`; versioned query strings are used for busting. Add `no-cache` for HTML in production.
- **Rate limiting / HTTPS / helmet** — not configured; add before exposure.
- **JWT_SECRET** must be rotated to a strong random value; passwords minimums are not enforced beyond form validation.
- **Single process, in-memory nothing** — horizontally scalable at the app layer (sessions live in MySQL), except uploads live on local disk (move to object storage for multi-instance).

---

## 15. File Map

```
server.js                  Express bootstrap, static serving, error handler
schema.sql                 DB creation + 13 tables + seed plans/categories
seed.js                    Demo data (vendors, user, order, cart)
.env / .env.example        Configuration
src/
  config/db.js             mysql2 pool (dateStrings, limit 10)
  middleware/auth.js       JWT sign/verify, sessions, authRequired/Optional, requireVendor
  utils/http.js            HttpError, wrap(), date helpers
  utils/category-match.js  Fuzzy category matching + title-casing
  routes/                  auth, users, subscriptions, categories, products,
                           clients, cart, checkout, orders, dashboard
public/
  index.html dashboard.html
  css/styles.css           Design system + all components (mobile-first + desktop parity)
  js/api.js ui.js auth.js app.js views.js
  uploads/products/        Product images (vendor uploads + demo SVGs)
scripts/
  reset-demo-data.js       Demo data reset (--yes to apply)
  fix-demo-images.js       In-place demo SVG regeneration
test/
  api.test.js e2e.js       Contract tests + isolated E2E
SPEC.md                    This document
```
