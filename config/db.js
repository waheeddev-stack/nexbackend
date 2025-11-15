import mysql from "mysql2/promise";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// Always load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

let sslConfig = undefined;
// Accept common truthy values for DB_SSL
const dbSslRaw = (process.env.DB_SSL || "").toString().trim().toLowerCase();
const dbSslFlag = dbSslRaw === "1" || dbSslRaw === "true" || dbSslRaw === "yes";

// Detect if a CA was explicitly provided via env (different from default fallback)
const hadCaEnv = typeof process.env.DB_SSL_CA !== 'undefined' || typeof process.env.DB_SSL_CA_CONTENT !== 'undefined';

// Use SSL when explicitly enabled or when CA was provided
const dbSsl = dbSslFlag || hadCaEnv;

// Support two ways of providing CA:
// 1) DB_SSL_CA: path to a file (e.g. /etc/secrets/ca.pem)
// 2) DB_SSL_CA: inline PEM content (starts with -----BEGIN CERTIFICATE-----)
// Also accept DB_SSL_CA_CONTENT as alternate env var containing PEM content.
let caEnvRaw = process.env.DB_SSL_CA || process.env.DB_SSL_CA_CONTENT;
let caEnv = caEnvRaw;
// If no explicit CA env provided, fall back to the common secrets path
if (!caEnvRaw) caEnv = "/etc/secrets/ca.pem";

console.log("DB_SSL:", process.env.DB_SSL);
console.log("DB_SSL_CA (env/raw):", typeof caEnv === 'string' ? (caEnv.length > 200 ? `${caEnv.slice(0,200)}...` : caEnv) : caEnv);
console.log("DB_SSL flag or CA provided (pre-check):", dbSsl);

// Determine whether CA is inline PEM or a path that exists in the container
const isInlinePem = typeof caEnv === 'string' && caEnv.includes('-----BEGIN');
let caPathExists = false;
if (!isInlinePem && typeof caEnv === 'string') {
  try {
    // Only mark as existing if file actually exists in the container filesystem
    caPathExists = fs.existsSync(caEnv);
  } catch (e) {
    caPathExists = false;
  }
}

// If env pointed to a Windows-local path (e.g. C:\Users\...), it's very likely
// not present inside the container. Detect and warn instead of trying to read it.
const looksLikeWindowsPath = typeof caEnv === 'string' && /^[A-Za-z]:\\/.test(caEnv);
if (looksLikeWindowsPath && !caPathExists && !isInlinePem) {
  console.warn(`DB_SSL_CA appears to be a Windows path that won't exist in the container: ${caEnv}`);
  console.warn("Set DB_SSL_CA to the PEM contents or mount the CA at /etc/secrets/ca.pem in the container.");
}

// Only enable/use SSL if DB_SSL flag is truthy, or we actually have inline PEM, or the file exists inside the container
const shouldUseSsl = dbSslFlag || isInlinePem || caPathExists;
console.log("DB_SSL effective (will attempt SSL if true):", shouldUseSsl);

if (shouldUseSsl) {
  try {
    let caBuffer;
    if (isInlinePem) {
      caBuffer = Buffer.from(caEnv, "utf8");
      console.log("Using inline CA PEM from env for MySQL SSL");
    } else if (caPathExists) {
      const caPath = caEnv;
      caBuffer = fs.readFileSync(caPath);
      console.log("Using CA file for MySQL SSL:", caPath);
    } else {
      // This branch should not happen due to shouldUseSsl check, but keep safe fallback
      throw new Error("SSL requested but no valid CA provided or found");
    }

    sslConfig = {
      ca: caBuffer,
      rejectUnauthorized: true,
    };
    console.log("Using SSL for MySQL connection");
  } catch (err) {
    console.error("Failed to load CA data for MySQL SSL:", err?.message || err);
    console.error("SSL will be disabled to avoid connection attempts with invalid CA. Update DB_SSL_CA or mount the CA file.");
    sslConfig = undefined;
  }
} else {
  console.log("NOT using SSL for MySQL connection (DB_SSL not set and no CA available inside container)");
}

// Validate basic DB config before attempting to create a pool
const dbHost = process.env.DB_HOST;
const dbPort = process.env.DB_PORT || 4000;
const dbUser = process.env.DB_USER;
const dbName = process.env.DB_NAME;

let pool;
if (!dbHost) {
  console.error("FATAL: DB_HOST is not set. The application cannot connect to MySQL without DB_HOST.");
  console.error("Set DB_HOST in your environment (Railway variables or mounted .env) to your database host.");
  console.error("The server will continue to run, but any DB calls will throw a clear error until DB_HOST is configured.");

  // Create a fake pool that surfaces a helpful error when used. This avoids process.exit
  // so the server can start (useful for local dev / static pages) while DB is not configured.
  const missingErr = new Error("Database not configured: DB_HOST is not set in environment variables.");
  pool = {
    query: async function () { throw missingErr; },
    execute: async function () { throw missingErr; },
    getConnection: async function () { throw missingErr; },
    // keep an end/close method just in case
    end: async function () { /* no-op */ },
  };
} else {
  console.log(`Creating MySQL pool for ${dbUser || 'unknown user'}@${dbHost}:${dbPort}/${dbName || ''}`);

  pool = mysql.createPool({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: process.env.DB_PASS,
    database: dbName,
    ssl: sslConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
}

(async () => {
  try {
    const connection = await pool.getConnection();
    console.log("MySQL connected successfully!");
    connection.release();
  } catch (err) {
    console.error("MySQL connection failed:", err && err.message ? err.message : err);
    // Print stack where available for debugging
    if (err && err.stack) console.error(err.stack);
  }
})();

export default pool;