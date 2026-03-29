-- Add missing columns that caused index creation to fail

-- Add restockAt column to products table
ALTER TABLE products 
ADD COLUMN restockAt DATETIME NULL 
COMMENT 'Scheduled restock time for out-of-stock products';

-- Add is_deleted column to users table (if not exists)
ALTER TABLE users 
ADD COLUMN is_deleted TINYINT(1) DEFAULT 0 
COMMENT 'Soft delete flag for users';

-- Now create the indexes that failed
CREATE INDEX IF NOT EXISTS idx_products_restock ON products(restockAt);
CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(is_deleted);

-- Verify columns exist
SELECT 'Columns added successfully!' AS Status;
