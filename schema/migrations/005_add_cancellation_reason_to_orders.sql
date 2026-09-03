-- Migration: Add cancellation_reason column to orders table (Postgres)
-- Fixes: GET /api/orders 500 — error: column o.cancellation_reason does not exist (42703)
-- The column exists in MySQL-era schemas but was never added to the Postgres orders table.

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT DEFAULT NULL;

-- Backfill NULL-safe index is unnecessary; column is informational only.
