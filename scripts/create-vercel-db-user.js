/**
 * Creates (or recreates) the dedicated MySQL user that the Vercel deployment
 * uses to reach this machine's MySQL through the ngrok TCP tunnel.
 *
 * Reads from .env:
 *   DB_USER / DB_PASSWORD  — local admin credentials (e.g. root)
 *   DB_NAME                — database to grant access to (default: storepanel)
 *   VERCEL_DB_PASSWORD     — password for the new 'vercel' user (keep secret)
 *
 * Re-runnable: drops and recreates the user, so it also works for password
 * rotations. Never prints the password.
 *
 * Usage: node scripts/create-vercel-db-user.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const ADMIN_USER = process.env.DB_USER;
const ADMIN_PASSWORD = process.env.DB_PASSWORD;
const HOST = process.env.DB_HOST || '127.0.0.1';
const PORT = Number(process.env.DB_PORT || 3306);
const DATABASE = process.env.DB_NAME || 'storepanel';
const NEW_USER = 'vercel';
const NEW_PASSWORD = process.env.VERCEL_DB_PASSWORD;

async function main() {
  const missing = [];
  if (!ADMIN_USER) missing.push('DB_USER');
  if (ADMIN_PASSWORD === undefined) missing.push('DB_PASSWORD');
  if (!NEW_PASSWORD) missing.push('VERCEL_DB_PASSWORD');
  if (missing.length) {
    console.error(`Missing required .env values: ${missing.join(', ')}`);
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: HOST,
    port: PORT,
    user: ADMIN_USER,
    password: ADMIN_PASSWORD,
    multipleStatements: true,
  });

  try {
    // Recreate cleanly so the script can be re-run after a password rotation.
    await conn.query(`DROP USER IF EXISTS '${NEW_USER}'@'%'`);
    await conn.query(`CREATE USER '${NEW_USER}'@'%' IDENTIFIED BY '${NEW_PASSWORD.replace(/'/g, "''")}'`);
    await conn.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DATABASE}\`.* TO '${NEW_USER}'@'%'`);
    await conn.query('FLUSH PRIVILEGES');
    const [rows] = await conn.query(
      `SELECT User, Host FROM mysql.user WHERE User = '${NEW_USER}'`
    );
    console.log(`OK — user '${NEW_USER}'@'%' created with SELECT/INSERT/UPDATE/DELETE on \`${DATABASE}\`.*`);
    console.log(`Verified in mysql.user:`, rows.map((r) => `${r.User}@${r.Host}`).join(', '));
    console.log('The password was taken from VERCEL_DB_PASSWORD in .env and is not displayed.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(`FAILED: ${err.code || ''} ${err.message}`);
  process.exit(1);
});
