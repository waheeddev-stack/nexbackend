import mysql from "mysql2/promise";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// Load .env from project root (if not already loaded elsewhere)
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

let sslConfig = undefined;
const dbSsl = process.env.DB_SSL && process.env.DB_SSL.trim().toLowerCase() === "true";
const caPath = process.env.DB_SSL_CA || path.resolve(process.cwd(), "secrets", "ca.pem");

if (dbSsl) {
  try {
    sslConfig = {
      ca: fs.readFileSync(caPath),
      rejectUnauthorized: true,
    };
    console.info("MySQL: using SSL (CA loaded)");
  } catch (err) {
    console.warn("MySQL: failed to read CA file:", caPath, err.message);
  }
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: sslConfig,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONN_LIMIT) || 10,
  queueLimit: 0,
  namedPlaceholders: true,
});

(async () => {
  try {
    const connection = await pool.getConnection();
    console.log("MySQL connected successfully!");
    connection.release();
  } catch (err) {
    console.error("MySQL connection failed:", err.message);
  }
})();

export default pool;