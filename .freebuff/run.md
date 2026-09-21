# StorePanel — Run Doc

## Reproduce artifacts (fresh checkout)

1. **Environment file** — copy `.env` from the main checkout (`D:\ASHWIN\ashwin\connect_vendors\.env`) into the worktree root. It holds `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` (local XAMPP MariaDB) and `JWT_SECRET`. Never commit it.
2. **Dependencies** — `npm install` (packages: express, mysql2/promise pool, bcryptjs, jsonwebtoken, multer; dev: none).
3. **Database** — MariaDB (XAMPP) must be running at `localhost:3306`. Create schema + base rows with `mysql -u root < schema.sql`, then `node seed.js` for demo data (idempotent; `--force` re-seeds). Full demo reset: `node scripts/reset-demo-data.js --yes` (wipes everything except `user` + `subscription`).

## Run the server

- Default: `npm run dev` (`node --watch server.js`) — listens on **http://localhost:3002** (override with `PORT` env).
- Health check: `GET /api/health` → `{"success":true,"data":{"status":"ok"}}`.
- Login page: `/` · App: `/dashboard.html` (login-only; demo creds after seed: `sundar.traders@gmail.com` / `demo1234`).

## Tests

- `node test/api.test.js` — source-contract tests (no server needed).
- `node test/e2e.js` — full API suite against a throwaway DB `storepanel_e2e` on port 3100; creates and drops it itself.
