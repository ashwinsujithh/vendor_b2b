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

async function main() {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SSL, DB_SSL_CA } = process.env;
  if (!DB_HOST || !DB_USER) {
    console.error('Missing DB_* values in .env — set them from your provider first.');
    process.exit(1);
  }

  const ssl = DB_SSL
    ? {
        rejectUnauthorized: true,
        ...(DB_SSL_CA
          ? {
              ca: DB_SSL_CA.includes('-----BEGIN')
                ? DB_SSL_CA
                : fs.readFileSync(path.resolve(DB_SSL_CA)),
            }
          : {}),
      }
    : undefined;

  // Connect without a default database first: the database itself may not exist
  // yet on a fresh service (Aiven free tier lets us CREATE DATABASE).
  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: Number(DB_PORT || 3306),
    user: DB_USER,
    password: DB_PASSWORD,
    ssl,
    multipleStatements: true,
    connectTimeout: 20000,
  });

  const dbName = DB_NAME || 'storepanel';
  console.log(`Connected to ${DB_HOST}:${DB_PORT || 3306} as ${DB_USER}`);

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
