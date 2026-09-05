-- Migration: Add idempotency_key column to orders table (Postgres / Neon)
-- Purpose: Support idempotent order creation to prevent duplicate orders
-- Date: March 29, 2026

-- Add idempotency_key column if it doesn't exist
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255) UNIQUE DEFAULT NULL;

-- Create index for faster lookups (unique constraint already creates one; keep for compat)
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key);

-- Verify the column was added (Postgres catalog)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'orders' AND column_name = 'idempotency_key';
