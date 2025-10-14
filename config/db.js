import mysql from "mysql2/promise";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

let sslConfig = undefined;
if (process.env.DB_SSL === "true") {
  console.log("Using SSL for MySQL connection");
  sslConfig = {
    ca: fs.readFileSync(process.env.DB_SSL_CA),
    rejectUnauthorized: true,
  };
} else {
  console.log("NOT using SSL for MySQL connection");
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,     // TiDB host
  port: process.env.DB_PORT || 4000, // TiDB default port
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: sslConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log(" MySQL connected successfully!");
    connection.release();
  } catch (err) {
    console.error(" MySQL connection failed:", err.message);
  }
})();

export default pool;