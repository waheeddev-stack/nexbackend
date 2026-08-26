/**
 * Migration: Add images column to products table
 * Stores a JSON array of product image URLs (multi-image support).
 * Run the SQL below in your database client (MySQL / TiDB).
 */

const sqlCommands = `
-- Migration: Add images column to products table
-- Run these SQL commands in your database client or directly in your database

-- Step 1: Add images column (JSON array of URLs stored as TEXT)
ALTER TABLE products
ADD COLUMN images TEXT NULL;

-- Step 2: Verify the change
SHOW COLUMNS FROM products LIKE "images";

-- Expected output should show the new images column (type TEXT, NULL allowed)
`;

console.log("📋 Migration SQL Commands:");
console.log("=".repeat(60));
console.log(sqlCommands);
console.log("=".repeat(60));
console.log("\n💡 To run this migration:");
console.log(
  "1. Open your database client (e.g., MySQL Workbench, TiDB Cloud Console)"
);
console.log("2. Select your database");
console.log("3. Run the SQL commands above");
console.log("4. Verify the changes with SHOW COLUMNS FROM products;");

export { sqlCommands };
