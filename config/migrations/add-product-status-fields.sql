-- Migration: Add available_stock and is_visible columns to products table
-- Run this SQL script to add the new fields for managing product availability status

-- Step 1: Check if columns already exist
-- (Optional - can be removed after migration runs successfully)

-- Step 2: Add available_stock column
ALTER TABLE products
ADD COLUMN available_stock VARCHAR(20) DEFAULT 'IN STOCK';

-- Step 3: Add is_visible column
ALTER TABLE products
ADD COLUMN is_visible TINYINT(1) DEFAULT 1;

-- Step 4: Update existing products with default values
UPDATE products
SET available_stock = 'IN STOCK'
WHERE available_stock IS NULL;

UPDATE products
SET is_visible = 1
WHERE is_visible IS NULL;

-- Step 5: Verify the changes
SHOW COLUMNS FROM products LIKE "available_stock";
SHOW COLUMNS FROM products LIKE "is_visible";

-- Expected output should show the new columns with their data types
