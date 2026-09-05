-- Migration: Add mrp column to products table (Postgres / Neon)
-- Purpose: Support MRP (Maximum Retail Price) from global catalog

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS mrp DECIMAL(10,2) DEFAULT NULL;

-- Backfill mrp = price for existing products that lack it
UPDATE products SET mrp = price WHERE mrp IS NULL;
