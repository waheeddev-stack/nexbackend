/**
 * Migration: Add available_stock and is_visible columns to products table
 * This script generates the SQL commands needed for the migration
 */

const sqlCommands = `
-- Migration: Add available_stock and is_visible columns to products table
-- Run these SQL commands in your database client or directly in your database

-- Step 1: Add available_stock column
ALTER TABLE products
ADD COLUMN available_stock VARCHAR(20) DEFAULT 'IN STOCK';

-- Step 2: Add is_visible column
ALTER TABLE products
ADD COLUMN is_visible TINYINT(1) DEFAULT 1;

-- Step 3: Update existing products with default values
UPDATE products
SET available_stock = 'IN STOCK'
WHERE available_stock IS NULL;

UPDATE products
SET is_visible = 1
WHERE is_visible IS NULL;

-- Step 4: Verify the changes
SHOW COLUMNS FROM products LIKE "available_stock";
SHOW COLUMNS FROM products LIKE "is_visible";

-- Expected output should show the new columns with their data types
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
