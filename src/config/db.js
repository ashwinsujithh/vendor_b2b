const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'storepanel',
  connectionLimit: 10,
  // Managed MySQL hosts (Aiven, PlanetScale, Railway, etc.) require TLS.
  // Set DB_SSL=1 to enable. Most providers (e.g. Aiven) sign with their own
  // CA, so also set DB_SSL_CA to the provider's CA certificate (PEM contents
  // or an absolute/relative file path to the .pem file).
  ssl: process.env.DB_SSL
    ? {
        rejectUnauthorized: true,
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
