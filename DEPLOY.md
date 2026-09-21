# Deploying to Vercel

The app is a standard Express server. On Vercel it runs as a **single serverless
function** (`server.js`) that handles every route — `vercel.json` in the repo
root wires this up, and `server.js` exports the app without binding a port.

## 1. Required environment variables

In the Vercel dashboard → your project → **Settings → Environment Variables**,
add (for Production, Preview **and** Development):

| Key | Example | Notes |
|---|---|---|
| `DB_HOST` | `your-host.db.example.com` | From your MySQL provider |
| `DB_PORT` | `3306` | Default `3306` |
| `DB_USER` | `storepanel` | |
| `DB_PASSWORD` | `********` | |
| `DB_NAME` | `storepanel` | Schema must exist first |
| `JWT_SECRET` | long random string | Required in production |
| `DB_SSL` | `1` | Only if your host requires TLS (PlanetScale/Aiven/Railway do) |

> ⚠️ **Vercel has no local MySQL.** Point `DB_HOST` at a hosted MySQL service
> (PlanetScale, Aiven, Railway, Neon MySQL-compatible, your own VPS...). A
> `DB_HOST` of `localhost` is the most common cause of `500
> FUNCTION_INVOCATION_FAILED` on the first request.

## 2. Create the schema on the hosted database

Run the schema (and optional demo seed) against the remote database from your
machine:

```bash
mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < schema.sql
node seed.js    # optional demo data; uses the same .env values
```

## 3. Deploy

Push to `main` (or import the repo at vercel.com/new). Vercel auto-detects the
`vercel.json` — no build step is needed. After the deploy, verify:

```
https://<your-app>.vercel.app/api/health
# → {"success":true,"data":{"status":"ok"}}
```

If a deploy fails, **Vercel dashboard → Deployments → (latest) → Functions tab**
shows the actual stack trace (`vercel logs` works too).

## 4. Known limits on Vercel (read before relying on it)

- **Product image uploads are ephemeral.** Serverless filesystems are
  read-only, so uploads go to `/tmp` and **vanish when the instance recycles**.
  For real usage, switch to object storage (Cloudinary, S3, R2) and store the
  returned URL in `product_image.image_url` — the code path is isolated in
  `src/routes/products.js` (`UPLOAD_DIR`, `uploadImages`).
- **Demo SVG product images** under `public/uploads/products/` are part of the
  repo, so they deploy fine; anything uploaded at runtime does not persist.
- Default serverless timeouts apply (10 s Hobby / 60 s Pro on Fluid). Checkout
  transactions are small and fit easily, but long image batches could hit it.
