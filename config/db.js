import mysql from "mysql2/promise";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// Always load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

let sslConfig = undefined;
// Accept common truthy values for DB_SSL
const dbSslRaw = (process.env.DB_SSL || "").toString().trim().toLowerCase();
const dbSsl = dbSslRaw === "1" || dbSslRaw === "true" || dbSslRaw === "yes";

// Support two ways of providing CA:
// 1) DB_SSL_CA: path to a file (e.g. /etc/secrets/ca.pem)
// 2) DB_SSL_CA: inline PEM content (starts with -----BEGIN CERTIFICATE-----)
// Also accept DB_SSL_CA_CONTENT as alternate env var containing PEM content.
const caEnv = process.env.DB_SSL_CA || process.env.DB_SSL_CA_CONTENT || "/etc/secrets/ca.pem";

console.log("DB_SSL:", process.env.DB_SSL);
console.log("DB_SSL_CA (env/raw):", typeof caEnv === 'string' ? (caEnv.length > 200 ? `${caEnv.slice(0,200)}...` : caEnv) : caEnv);

if (dbSsl) {
  try {
    let caBuffer;
    if (typeof caEnv === "string" && caEnv.includes("-----BEGIN")) {
      // Inline PEM provided in env var
      caBuffer = Buffer.from(caEnv, "utf8");
      console.log("Using inline CA PEM from env for MySQL SSL");
    } else {
      // treat as path
      const caPath = caEnv;
      caBuffer = fs.readFileSync(caPath);
      console.log("Using CA file for MySQL SSL:", caPath);
    }

    sslConfig = {
      ca: caBuffer,
      rejectUnauthorized: true,
    };
    console.log("Using SSL for MySQL connection");
  } catch (err) {
    console.error("Failed to load CA data for MySQL SSL:", err?.message || err);
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