-- Migration: Add restocking columns to products table (Postgres / Neon)
-- Purpose: Support auto-restock functionality with baseline quantities and scheduled restock times

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS baselineQty INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS restockAt TIMESTAMPTZ DEFAULT NULL;

-- Create index for efficient restock scheduling queries
CREATE INDEX IF NOT EXISTS idx_restock_at ON products(restockAt);
CREATE INDEX IF NOT EXISTS idx_baseline_qty ON products(baselineQty);
