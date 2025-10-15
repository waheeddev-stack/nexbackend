import mysql from "mysql2/promise";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// Always load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

let sslConfig = undefined;
const dbSsl = process.env.DB_SSL && process.env.DB_SSL.trim().toLowerCase() === "true";
const caPath = process.env.DB_SSL_CA || "/etc/secrets/ca.pem";

console.log("DB_SSL:", process.env.DB_SSL);
console.log("DB_SSL_CA:", caPath);

if (dbSsl) {
  try {
    sslConfig = {
      ca: fs.readFileSync(caPath),
      rejectUnauthorized: true,
    };
    console.log("Using SSL for MySQL connection");
  } catch (err) {
    console.error("Failed to read CA file:", caPath, err.message);
  }
} else {
  console.log("NOT using SSL for MySQL connection");
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 4000,
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
    console.log("MySQL connected successfully!");
    connection.release();
  } catch (err) {
    console.error("MySQL connection failed:", err.message);
  }
})();

export default pool;