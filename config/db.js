import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

// Always load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

let sslConfig = undefined;
const dbSsl =
  process.env.DB_SSL && process.env.DB_SSL.trim().toLowerCase() === "true";

if (process.env.NODE_ENV !== "production") {
  console.log("🔍 Database Configuration:");
  console.log("- DB_HOST:", process.env.DB_HOST);
  console.log("- DB_PORT:", process.env.DB_PORT);
  console.log("- DB_USER:", process.env.DB_USER ? "SET" : "NOT SET");
  console.log("- DB_NAME:", process.env.DB_NAME);
  console.log("- DB_SSL:", process.env.DB_SSL);
}

if (dbSsl) {
  // For TiDB Cloud, we can use SSL without specifying CA certificate
  // TiDB Cloud uses standard SSL certificates that are trusted by default
  sslConfig = {
    rejectUnauthorized: false, // For TiDB Cloud compatibility
  };
  console.log("Using SSL for TiDB Cloud connection");
} else {
  console.log("NOT using SSL for database connection");
}

// TiDB Cloud Pool Configuration
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 4000,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: sslConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
});

// Test database connection on startup
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log("✅ TiDB Cloud connected successfully!");
    console.log("📊 Connected to TiDB Cloud database:", process.env.DB_NAME);

    // Test a simple query
    const [rows] = await connection.execute("SELECT 1 as test");
    console.log("🔍 Database test query successful:", rows);

    // Check if tables exist
    const [tables] = await connection.execute("SHOW TABLES");
    console.log(`📋 Found ${tables.length} tables in database`);

    // Check products count
    try {
      const [productCount] = await connection.execute(
        "SELECT COUNT(*) as count FROM products"
      );
      console.log(`🛍️ Products in database: ${productCount[0].count}`);
    } catch (error) {
      console.log(`⚠️ Products table check: ${error.message}`);
    }

    connection.release();
  } catch (err) {
    console.error("❌ TiDB Cloud connection failed:", err.message);
    console.error("🔧 Connection details:", {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      database: process.env.DB_NAME,
      ssl: !!sslConfig,
    });

    console.log("💡 Check your TiDB Cloud connection parameters");
    console.log("💡 Verify database exists and credentials are correct");
    console.log("💡 Check if TiDB Cloud cluster is running");
  }
})();

export default pool;
