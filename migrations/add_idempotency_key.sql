-- Migration: Add idempotency_key column to orders table
-- Purpose: Support idempotent order creation to prevent duplicate orders
-- Date: March 29, 2026

-- Add idempotency_key column if it doesn't exist
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255) UNIQUE DEFAULT NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key);

-- Verify the column was added
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'orders' AND COLUMN_NAME = 'idempotency_key';
