const mysql = require('mysql2/promise');

// Workaround for flaky local DNS (resolves DB_HOST via DNS-over-HTTPS when the
// OS resolver fails). No-op on healthy networks or on Vercel.
require('./dns-fix');

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

module.exports = pool;
