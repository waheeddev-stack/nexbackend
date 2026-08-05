-- Migration: Ensure columns required for wallet savings display
-- Purpose: Guarantee order.instant_discount and product.mrp exist regardless
--          of which earlier migrations/server bootstraps have already run.
-- Idempotent: safe to run multiple times.

-- 1) instant discount applied at checkout (50% of tiered discount), in rupees
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS instant_discount DECIMAL(10,2) DEFAULT 0.00 COMMENT 'Instant discount amount applied at checkout (50% of tiered discount)';

-- Backfill any historical rows that ended up with NULL instant_discount
UPDATE orders SET instant_discount = 0.00 WHERE instant_discount IS NULL;

-- 2) Maximum Retail Price from global catalog
ALTER TABLE products
ADD COLUMN IF NOT EXISTS mrp DECIMAL(10,2) DEFAULT NULL COMMENT 'Maximum Retail Price from global catalog';

-- Backfill mrp = price for existing products that lack it
UPDATE products SET mrp = price WHERE mrp IS NULL;