-- Add soft delete columns to shopkeepers table
-- Run this on TiDB Cloud SQL Editor

-- Add is_deleted column (0 = active, 1 = deleted)
ALTER TABLE shopkeepers 
ADD COLUMN IF NOT EXISTS is_deleted TINYINT(1) DEFAULT 0;

-- Add deleted_at timestamp column
ALTER TABLE shopkeepers 
ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL;

-- Add index for better query performance
ALTER TABLE shopkeepers 
ADD INDEX IF NOT EXISTS idx_is_deleted (is_deleted);

-- Verify columns were added
DESCRIBE shopkeepers;

-- Check existing data (should all be 0 for is_deleted)
SELECT id, name, email, is_deleted, deleted_at 
FROM shopkeepers 
LIMIT 10;
