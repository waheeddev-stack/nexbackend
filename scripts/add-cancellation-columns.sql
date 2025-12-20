-- Add cancellation tracking columns to orders table
-- Run this on TiDB Cloud dashboard or production database

-- Add cancelled_by column (who cancelled: 'user' or 'shopkeeper')
ALTER TABLE orders 
ADD COLUMN cancelled_by VARCHAR(20) NULL AFTER status;

-- Add cancellation_reason column (reason for cancellation)
ALTER TABLE orders 
ADD COLUMN cancellation_reason TEXT NULL AFTER cancelled_by;

-- Verify columns were added
DESCRIBE orders;

-- Check existing cancelled orders (should show NULL for new columns)
SELECT id, status, cancelled_by, cancellation_reason 
FROM orders 
WHERE status = 'Cancelled' 
LIMIT 5;
