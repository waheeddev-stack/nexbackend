-- Migration: Add available_stock and is_visible columns to products table (Postgres / Neon)
-- Run this SQL script to add the new fields for managing product availability status

-- Step 1: Add available_stock column
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS available_stock VARCHAR(20) DEFAULT 'IN STOCK';

-- Step 2: Add is_visible column (TINYINT(1) -> SMALLINT in PG)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_visible SMALLINT DEFAULT 1;

-- Step 3: Update existing products with default values
UPDATE products
SET available_stock = 'IN STOCK'
WHERE available_stock IS NULL;

UPDATE products
SET is_visible = 1
WHERE is_visible IS NULL;

-- Step 4: Verify the changes (Postgres catalog)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'products' AND column_name IN ('available_stock', 'is_visible');
