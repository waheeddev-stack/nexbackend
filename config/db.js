import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

// Always load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

if (process.env.NODE_ENV !== 'production') {
  console.log("🔍 Database Configuration:");
  console.log("- DB_HOST:", process.env.DB_HOST);
  console.log("- DB_PORT:", process.env.DB_PORT);
  console.log("- DB_USER:", process.env.DB_USER ? 'SET' : 'NOT SET');
  console.log("- DB_NAME:", process.env.DB_NAME);
  console.log("- DB_SSL:", process.env.DB_SSL || 'false');
}

// XAMPP MySQL Pool Configuration (NO SSL)
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'nexkiranadb',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true
});

// Test database connection on startup
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log("✅ MySQL connected successfully!");
    console.log("📊 Connected to XAMPP database:", process.env.DB_NAME || 'nexkiranadb');
    
    // Test a simple query
    const [rows] = await connection.execute('SELECT 1 as test');
    console.log("🔍 Database test query successful:", rows);
    
    // Check if tables exist
    const [tables] = await connection.execute('SHOW TABLES');
    console.log(`📋 Found ${tables.length} tables in database`);
    
    connection.release();
  } catch (err) {
    console.error("❌ MySQL connection failed:", err.message);
    console.error("🔧 Connection details:", {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      database: process.env.DB_NAME || 'nexkiranadb'
    });
    
    console.log("💡 Make sure XAMPP MySQL is running on localhost:3306");
    console.log("💡 Check if database 'nexkiranadb' exists in phpMyAdmin");
  }
})();

export default pool;