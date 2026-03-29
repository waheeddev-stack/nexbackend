-- Fix restockAt column issue
-- Add the missing restockAt column to products table

-- Check if column exists, if not add it
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS restockAt DATETIME NULL 
COMMENT 'Scheduled restock time for out-of-stock products';

-- Add index for faster restock queries
CREATE INDEX IF NOT EXISTS idx_products_restock ON products(restockAt);

-- Verify the column was added
DESCRIBE products;
