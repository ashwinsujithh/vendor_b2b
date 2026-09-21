const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'storepanel',
  connectionLimit: 10,
  // Return DATE/DATETIME as strings ('YYYY-MM-DD') so date comparisons
  // against todayStr() work predictably.
  dateStrings: true,
});

module.exports = pool;
