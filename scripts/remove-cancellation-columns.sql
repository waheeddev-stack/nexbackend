-- Remove cancellation tracking columns from orders table
-- Run this on TiDB Cloud SQL Editor

-- Check if columns exist first
SELECT COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'orders' 
  AND TABLE_SCHEMA = DATABASE()
  AND COLUMN_NAME IN ('cancelled_by', 'cancellation_reason');

-- If the above query shows these columns exist, run the following:

-- Drop cancelled_by column if it exists
ALTER TABLE orders DROP COLUMN IF EXISTS cancelled_by;

-- Drop cancellation_reason column if it exists
ALTER TABLE orders DROP COLUMN IF EXISTS cancellation_reason;

-- Verify columns are removed
SELECT COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'orders' 
  AND TABLE_SCHEMA = DATABASE()
ORDER BY ORDINAL_POSITION;

-- Done! Orders should now work correctly.
