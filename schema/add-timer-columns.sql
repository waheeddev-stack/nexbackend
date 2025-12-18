-- Add timer columns to orders table for pickup verification system
-- Run this migration to enable the timer feature

-- Add timer-related columns to orders table
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS has_timer TINYINT(1) DEFAULT 0,
ADD COLUMN IF NOT EXISTS pickup_code VARCHAR(10) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS timer_started_at DATETIME DEFAULT NULL,
ADD COLUMN IF NOT EXISTS timer_expires_at DATETIME DEFAULT NULL;

-- Update status enum to include 'Completed' instead of just 'Delivered'
-- Note: TiDB may require recreating the column for enum changes
-- For now, we'll keep both statuses working

-- Add index for faster pickup code lookups
CREATE INDEX IF NOT EXISTS idx_orders_pickup_code ON orders(pickup_code);

-- Verify the columns were added
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'orders' 
AND COLUMN_NAME IN ('has_timer', 'pickup_code', 'timer_started_at', 'timer_expires_at');
