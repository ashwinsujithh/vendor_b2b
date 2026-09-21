# StorePanel — User Panel (Node.js + Express + MySQL)

A complete user panel with authentication, role-based access (Customer ↔ Vendor via subscriptions), product/category/cart/checkout/order management, and subscription plan limits — built on the provided MySQL schema (`user`, `subscription`, `address`, `category`, `product`, `cart`, `checkout`, `order`, `order_item`).

## Features

- **Auth** — register & login (bcrypt + JWT). Dashboard adapts to the user's role.
- **Roles** — a normal user can shop, manage cart/addresses, check out and view orders. Buying **any** subscription plan promotes the user to **Vendor/Admin**.
- **Vendor tools** — CRUD their **own** products, manage categories, view orders received for their products, update order status & leave notes.
- **Subscription limits** — vendors cannot create more products than their plan's `number_of_products`; buyers cannot exceed a vendor's `number_of_clients` (one order per client counts once). Plans: Silver, Gold, Premium, Enterprise.
- **Cart & checkout** — add/update/remove cart items, stock validation, checkout with address selection; multi-vendor carts are split into one order per vendor inside a single DB transaction.
- **Profile** — edit name/alt phone/email, manage addresses, view current plan + validity, upgrade/renew plans.
- **UI** — responsive dashboard with sidebar navigation; vendor sections appear only for vendors; product form uses a **category dropdown** (no free-text category creation).

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure the database
cp .env.example .env        # then edit DB_USER / DB_PASSWORD etc.

# 3. Create schema + seed plans & categories
mysql -u root -p < schema.sql

# 4. (Optional) seed demo data
node seed.js

# 5. Run
npm start                   # http://localhost:3002
```

### Demo accounts (after `node seed.js`)

| Role | Email | Password |
|---|---|---|
| Vendor — Sundar Traders (Gold) | sundar.traders@gmail.com | demo1234 |
| Vendor — FreshMart (Gold) | freshmart.india@gmail.com | demo1234 |
| Vendor — TechNest (Silver) | technest.store@gmail.com | demo1234 |
| Customer — Meera (Sundar's client) | meera.krishnan@gmail.com | demo1234 |

## API overview

| Method & path | Access | Purpose |
|---|---|---|
| `POST /api/auth/register` | public | Create account |
| `POST /api/auth/login` | public | Login (returns JWT) |
| `GET /api/auth/me` | any | Current user + plan |
| `GET/PUT /api/profile` | any | View/edit profile |
| `GET/POST/PUT/DELETE /api/addresses` | any | Manage addresses |
| `GET /api/subscriptions` | any | List plans |
| `POST /api/subscriptions/purchase` | any | Buy/renew plan → becomes vendor |
| `GET /api/categories` | any | List (for dropdowns) |
| `POST/PUT/DELETE /api/categories/:id` | vendor | Manage categories |
| `GET /api/products` | any | Browse products |
| `GET /api/products/:id` | any | Product detail with images and specifications |
| `GET /api/products/mine` | vendor | Own products |
| `POST/PUT/DELETE /api/products/:id` | vendor | Own products only (plan limit enforced) |
| `GET/POST/DELETE /api/products/:id/images` | vendor owner | Manage product image records |
| `GET/POST/PUT/DELETE /api/products/:id/specifications` | vendor owner | Manage product specification records |
| `GET/POST/PUT/DELETE /api/cart` | any | Cart operations |
| `POST /api/checkout` | any | Place order(s) from cart |
| `GET /api/orders` | any | Own order history |
| `GET /api/orders/vendor` | vendor | Orders received |
| `PUT /api/orders/:id/status` / `PUT /api/orders/:id/note` | vendor | Fulfil orders |
| `GET /api/dashboard` | any | Role-aware stats |

## Business rules enforced server-side

1. Normal users get **403** on vendor endpoints until they buy a plan (`user.sub_valid_to` in the future).
2. `POST /api/products` counts the vendor's products and rejects creation beyond `number_of_products`.
3. Product `category_id` must reference an existing category — the UI only offers a dropdown.
4. Checkout validates stock, enforces each vendor's `number_of_clients` (new clients only), creates `checkout` → `order` (one per vendor) → `order_item` rows, decrements stock, and clears the cart — atomically.
