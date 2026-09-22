# Deploying to Vercel

The app is a standard Express server. On Vercel it runs as a **single serverless
function** (`server.js`) that handles every route — `vercel.json` in the repo
root wires this up, and `server.js` exports the app without binding a port.

## 1. Database: Aiven free MySQL (recommended)

Vercel has **no local MySQL** and its marketplace has no MySQL integration
(MongoDB there is *not* compatible with this codebase). The hosted provider
this project uses is [Aiven](https://aiven.io/free-mysql-database): an
always-free, fully managed MySQL — no credit card, 5 GB storage, more than
enough here.

### One-time setup

1. Sign up at aiven.io → **Create service → MySQL → Free plan**. Pick the
   region closest to your Vercel deployment region (check the deployment's
   region code, e.g. `bom1` = Mumbai → `asia-south1`). Wait for the service to
   turn green.
2. From the Aiven console (**Overview → Connection information**): note the
   **host**, **port** (`3306` usually), **admin user** (`avnadmin`) and its
   password, and **download the CA certificate** (`ca.pem`).
3. Import the schema + demo data from this machine:

   ```bash
   # fill .env with the Aiven values first (DB_SSL=1, DB_SSL_CA=path/to/ca.pem)
   node scripts/import-schema.js --seed
   ```

4. `scripts/import-schema.js` is re-runnable (all statements are
   `CREATE ... IF NOT EXISTS` / `INSERT IGNORE`), so it's safe to run again.

### Environment variables

In the Vercel dashboard → your project → **Settings → Environment Variables**,
add (for Production, Preview **and** Development):

| Key | Example | Notes |
|---|---|---|
| `DB_HOST` | `mydb-myteam.a.aivencloud.com` | From Aiven connection info |
| `DB_PORT` | `3306` | As shown by Aiven |
| `DB_USER` | `avnadmin` | Or a limited user you create |
| `DB_PASSWORD` | `********` | |
| `DB_NAME` | `storepanel` | Created by the import script |
| `JWT_SECRET` | long random string | Required in production |
| `DB_SSL` | `1` | Aiven **requires** TLS |
| `DB_SSL_CA` | contents of `ca.pem` **or** its file path | Aiven signs with its own CA |

> `DB_SSL_CA` accepts either the PEM text itself or a path to the `.pem` file
> (see `src/config/db.js`). Without it the connection fails certificate
> verification.

**Redeploy after saving** env vars (Deployments → ⋯ → Redeploy) — changes
don't apply to the already-running function. Then verify:

```
https://<your-app>.vercel.app/api/health
# → {"success":true,"data":{"status":"ok"}}
```

Plus one real request that touches the DB (e.g. a login) — health doesn't
prove the database is reachable.

## 2. Deploy

Push to `main` (or import the repo at vercel.com/new). Vercel auto-detects the
`vercel.json` — no build step is needed. If a deploy fails, **Vercel dashboard
→ Deployments → (latest) → Functions tab** shows the actual stack trace
(`vercel logs` works too).

## 3. Known limits on Vercel (read before relying on it)

- **Product image uploads are ephemeral.** Serverless filesystems are
  read-only, so uploads go to `/tmp` and **vanish when the instance recycles**.
  For real usage, switch to object storage (Cloudinary, S3, R2) and store the
  returned URL in `product_image.image_url` — the code path is isolated in
  `src/routes/products.js` (`UPLOAD_DIR`, `uploadImages`).
- **Demo SVG product images** under `public/uploads/products/` are part of the
  repo, so they deploy fine; anything uploaded at runtime does not persist.
- Default serverless timeouts apply (10 s Hobby / 60 s Pro on Fluid). Checkout
  transactions are small and fit easily, but long image batches could hit it.
- Aiven free tier: single node, 1 CPU / 1 GB RAM / 5 GB disk — fine for demos
  and small shops, upgrade (or move) if it outgrows it.

## 4. Appendix: demo mode — Vercel → laptop MySQL over ngrok

Superseded by section 1, kept for local demos when you want the deployed site
to read your laptop's data. **This is a demo setup**: the laptop must stay on,
and the tunnel dies when ngrok's free session limit (~2 h) hits or the machine
sleeps.

### One-time setup (already done on this machine)

- ngrok installed & updated (`winget install ngrok.ngrok` then `ngrok update`).
- ngrok authtoken configured (`%LOCALAPPDATA%\ngrok\ngrok.yml`).
- A dedicated MySQL user was created with limited grants:
  `node scripts/create-vercel-db-user.js` (re-runnable; password comes from
  `VERCEL_DB_PASSWORD` in `.env`). It gets only
  `SELECT/INSERT/UPDATE/DELETE` on `storepanel`.
- Free ngrok accounts must have a card on file before TCP endpoints are
  allowed (never charged): https://dashboard.ngrok.com/settings#id-verification

### Every time you want the deployed app working

```powershell
powershell -ExecutionPolicy Bypass -File .\tunnel.ps1
```

It prints `DB_HOST` / `DB_PORT` (e.g. `0.tcp.in.ngrok.io` / `12345`) and copies
`DB_HOST` to the clipboard. Then set those in Vercel env vars
(`DB_USER=vercel`, `DB_PASSWORD=$VERCEL_DB_PASSWORD`, `DB_NAME=storepanel`,
`DB_SSL` unset) and **redeploy**. The address is random per session — when the
tunnel drops, restart it and update `DB_HOST`/`DB_PORT`.

### Troubleshooting

- **Inspector** — `http://localhost:4040` shows every tunneled connection and
  the agent's errors.
- `ERR_NGROK_8013` → add the card (see above). `ERR_NGROK_121` → `ngrok update`.
- `ER_NOT_SUPPORTED_AUTH_MODE` / access denied from Vercel → re-run
  `node scripts/create-vercel-db-user.js` (MySQL 8 `caching_sha2_password`
  works over the tunnel; very old servers may need
  `ALTER USER 'vercel'@'%' IDENTIFIED WITH mysql_native_password BY '...'`).
