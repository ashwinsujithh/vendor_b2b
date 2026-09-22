/**
 * Imports the schema (and optionally demo data) into a remote MySQL database,
 * e.g. an Aiven free-tier service. Re-runnable: every statement in schema.sql
 * is CREATE ... IF NOT EXISTS, and the seed script self-skips.
 *
 * Reads from .env:
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME   — target database
 *   DB_SSL=1 + DB_SSL_CA                              — TLS (Aiven needs both)
 *   --seed flag                                       — also run seed.js after schema
 *
 * Why not `mysql -h ... < schema.sql`? Windows machines without the MySQL CLI
 * in PATH can't run it; this uses the project's own mysql2 driver instead.
 *
 * Usage:  node scripts/import-schema.js [--seed]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// Some Windows networks have flaky DNS for new domains; resolve via Google
// DNS-over-HTTPS first and pin the IP for this process. Harmless if it fails.
async function pinHost(host) {
  if (/^\d+(\.\d+){3}$/.test(host)) return;
  try {
    const res = await fetch(`https://dns.google/resolve?name=${host}&type=A`);
    const json = await res.json();
    const ip = (json.Answer || []).find((a) => a.type === 1);
    if (ip) {
      const record = ip.data;
      require('dns').lookup = (host, opts, cb) => {
        if (typeof opts === 'function') { cb = opts; opts = {}; }
        process.nextTick(() => {
          if (opts && opts.all) cb(null, [{ address: record, family: 4 }]);
          else cb(null, record, 4);
        });
      };
      console.log(`Resolved ${host} → ${record} (via dns.google)`);
    }
  } catch { /* fall back to OS resolution */ }
}

async function main() {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SSL, DB_SSL_CA } = process.env;
  if (!DB_HOST || !DB_USER) {
    console.error('Missing DB_* values in .env — set them from your provider first.');
    process.exit(1);
  }

  const ssl = DB_SSL
    ? {
        // Encrypted either way; CA verification only when DB_SSL_CA is set.
        rejectUnauthorized: !!DB_SSL_CA,
        ...(DB_SSL_CA
          ? {
              ca: DB_SSL_CA.includes('-----BEGIN')
                ? DB_SSL_CA
                : fs.readFileSync(path.resolve(DB_SSL_CA)),
            }
          : {}),
      }
    : undefined;

  const dbName = DB_NAME || 'storepanel';
  await pinHost(DB_HOST);
  console.log(`Connecting to ${DB_HOST}:${DB_PORT || 3306} as ${DB_USER}...`);

  // Connect without a default database first: the database itself may not exist
  // yet on a fresh service (Aiven free tier lets us CREATE DATABASE).
  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: Number(DB_PORT || 3306),
    user: DB_USER,
    password: DB_PASSWORD,
    database: undefined,
    ssl,
    multipleStatements: true,
    connectTimeout: 20000,
  });

  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log(`Database "${dbName}" ready.`);

  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  // schema.sql contains its own "CREATE DATABASE / USE storepanel" lines; strip
  // them so it applies to whatever DB_NAME actually is.
  const statements = schema
    .replace(/CREATE DATABASE IF NOT EXISTS storepanel[^;]*;/gi, '')
    .replace(/USE storepanel;/gi, '');

  await conn.query(`USE \`${dbName}\``);
  await conn.query(statements);

  const [tables] = await conn.query('SHOW TABLES');
  console.log(`Schema applied — ${tables.length} tables: ${tables.map((r) => Object.values(r)[0]).join(', ')}`);

  await conn.end();

  if (process.argv.includes('--seed')) {
    console.log('Seeding demo data...');
    const { execFileSync } = require('child_process');
    execFileSync(process.execPath, ['seed.js'], { stdio: 'inherit' });
  } else {
    console.log('Done. Run `node scripts/import-schema.js --seed` if you also want demo data.');
  }
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
