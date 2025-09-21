import mysql from "mysql2/promise";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "960901",
  database: process.env.DB_NAME || "kirana",
  ssl: process.env.DB_SSL === "true" ? {
    ca: fs.readFileSync(process.env.DB_SSL_CA_PATH || "/etc/secrets/ca.pem"),
    rejectUnauthorized: true,
  } : false,
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
