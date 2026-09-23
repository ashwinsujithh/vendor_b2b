const mysql = require('mysql2/promise');

// Workaround for flaky local DNS (resolves DB_HOST via DNS-over-HTTPS when the
// OS resolver fails). No-op on healthy networks or on Vercel.
require('./dns-fix');

// Align the MySQL session clock with this process's clock. Managed hosts (e.g.
// Aiven) run UTC while the laptop runs IST, so SQL NOW()/CURDATE() would
// otherwise disagree with JS new Date()/todayStr() — OTPs expired instantly,
// "today" boundaries drifted. Each host pins its own offset: Vercel = UTC,
// laptop = IST; naive DATETIMEs are written and read by the same convention.
const offMin = -new Date().getTimezoneOffset();
const pad = (n) => String(Math.abs(n)).padStart(2, '0');
const SESSION_TZ = `${offMin >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offMin) / 60))}:${pad(Math.abs(offMin) % 60)}`;

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'storepanel',
  connectionLimit: 10,
  // Managed MySQL hosts (Aiven, PlanetScale, Railway, etc.) require TLS.
  // Set DB_SSL=1 to enable. Optionally set DB_SSL_CA to the provider's CA
  // certificate (PEM contents or a file path) to verify the server identity;
  // without it the connection is still encrypted but not verified.
  ssl: process.env.DB_SSL
    ? {
        rejectUnauthorized: !process.env.DB_SSL_CA,
        ...(process.env.DB_SSL_CA
          ? { ca: process.env.DB_SSL_CA.includes('-----BEGIN')
              ? process.env.DB_SSL_CA
              : require('fs').readFileSync(process.env.DB_SSL_CA) }
          : {}),
      }
    : undefined,
  // Return DATE/DATETIME as strings ('YYYY-MM-DD') so date comparisons
  // against todayStr() work predictably.
  dateStrings: true,
});

pool.on('connection', (conn) => {
  conn.query(`SET time_zone = '${SESSION_TZ}'`);
});

module.exports = pool;
