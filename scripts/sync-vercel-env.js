/*
 * Pushes the local .env database settings into the Vercel project's
 * environment variables and (optionally) triggers a production deploy.
 *
 * Reads from .env:  VERCEL_TOKEN, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD,
 *                   DB_NAME  (+ DB_SSL / DB_SSL_CA defaults added here)
 * Never prints secret values.
 *
 * Run:  node scripts/sync-vercel-env.js
 * Run with deploy:  node scripts/sync-vercel-env.js --deploy
 */
require('dotenv').config({ quiet: true });
require('../src/config/dns-fix');

const TOKEN = process.env.VERCEL_TOKEN;
const TEAM = process.env.VERCEL_TEAM_ID || 'team_4C5kEA4IrvRl1vrIJ91kWfhQ';
const PROJECT = process.env.VERCEL_PROJECT_ID || 'prj_xI1Am6tjlfCzD6Xdcpy2t3nO8vtu';
const BASE = `https://api.vercel.com${TEAM ? `?teamId=${TEAM}` : ''}`;

if (!TOKEN) {
  console.error('VERCEL_TOKEN missing from .env — add it first.');
  process.exit(1);
}

async function api(path, opts = {}) {
  const res = await fetch(`https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${TEAM}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

// The vars this script owns. Values come from .env; DB_SSL/DB_SSL_CA get
// sensible defaults so the Aiven TLS connection works out of the box.
const OWNED = {
  DB_HOST: process.env.DB_HOST,
  DB_PORT: process.env.DB_PORT || '3306',
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_NAME: process.env.DB_NAME || 'storepanel',
  DB_SSL: '1',
  DB_SSL_CA: 'aiven-ca.pem',
};
// Stale vars to delete (old laptop/ngrok + unused MongoDB integration).
const STALE = ['VERCEL_DB_PASSWORD', 'MONGODB_URI', 'MONGODB_URL', 'MONGO_URI', 'NGROK_HOST', 'NGROK_PORT'];
const TARGETS = ['production', 'preview'];

(async () => {
  for (const [k, v] of Object.entries(OWNED)) {
    if (!v) { console.error(`✘ ${k} missing from .env`); process.exit(1); }
  }

  // 1. Delete stale vars + existing copies of owned vars (upsert = delete+create).
  const { envs } = await api(`/v9/projects/${PROJECT}/env`);
  for (const e of envs) {
    if (STALE.includes(e.key) || OWNED[e.key]) {
      await api(`/v9/projects/${PROJECT}/env/${e.id}`, { method: 'DELETE' });
      console.log(`✔ removed old ${e.key}`);
    }
  }

  // 2. Create the owned vars.
  for (const [key, value] of Object.entries(OWNED)) {
    await api(`/v10/projects/${PROJECT}/env`, {
      method: 'POST',
      body: JSON.stringify({ key, value, type: 'encrypted', target: TARGETS }),
    });
    console.log(`✔ set ${key}`);
  }

  console.log('\nAll environment variables synced from .env.');

  // 3. Optional production redeploy so the new vars take effect.
  if (process.argv.includes('--deploy')) {
    const d = await api(`/v13/deployments`, {
      method: 'POST',
      body: JSON.stringify({
        name: process.env.VERCEL_PROJECT_NAME || 'vendor-b2b',
        target: 'production',
        gitSource: {
          type: 'github',
          org: process.env.VERCEL_GIT_ORG || 'ashwinsujithh',
          repo: process.env.VERCEL_GIT_REPO || 'vendor_b2b',
          ref: 'main',
        },
      }),
    });
    console.log(`✔ production deploy triggered: ${d.url || d.uid}`);
  } else {
    console.log('Redeploy to apply (or rerun with --deploy).');
  }
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
