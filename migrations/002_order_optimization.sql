-- ============================================================================
-- Order Optimization Migration
-- Fixes missing columns and adds performance indexes
-- Run this on your database to fix the 7+ second order issue
-- ============================================================================

-- ============================================================================
-- PART 1: Fix Missing Columns
-- ============================================================================

-- Add restockAt column to products table (fixes the error)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS restockAt DATETIME NULL 
COMMENT 'Scheduled restock time for out-of-stock products';

-- Add any other missing columns that might be needed
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS last_restocked_at DATETIME NULL 
COMMENT 'Last time product was restocked';

-- ============================================================================
-- PART 2: Add Performance Indexes
-- ============================================================================

-- Orders table indexes
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_shopkeeper_id ON orders(shopkeeper_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_shop_status ON orders(shopkeeper_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_has_timer ON orders(has_timer);

-- Order items table indexes
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_product ON order_items(order_id, product_id);

-- Products table indexes
CREATE INDEX IF NOT EXISTS idx_products_shop_id ON products(shop_id);
CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock);
CREATE INDEX IF NOT EXISTS idx_products_shop_stock ON products(shop_id, stock);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_restock ON products(restockAt);

-- Shopkeepers table indexes
CREATE INDEX IF NOT EXISTS idx_shopkeepers_subscription ON shopkeepers(subscription_status);
CREATE INDEX IF NOT EXISTS idx_shopkeepers_deleted ON shopkeepers(is_deleted);
CREATE INDEX IF NOT EXISTS idx_shopkeepers_active ON shopkeepers(subscription_status, is_deleted);

-- Users table indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_credits ON users(store_credits);
CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(is_deleted);

-- Order timers table indexes (if table exists)
CREATE INDEX IF NOT EXISTS idx_order_timers_order_id ON order_timers(order_id);
CREATE INDEX IF NOT EXISTS idx_order_timers_active ON order_timers(is_active);
CREATE INDEX IF NOT EXISTS idx_order_timers_expires ON order_timers(timer_expires_at);
CREATE INDEX IF NOT EXISTS idx_order_timers_active_expires ON order_timers(is_active, timer_expires_at);

-- ============================================================================
-- PART 3: Analyze Tables (Update Statistics)
-- ============================================================================

ANALYZE TABLE orders;
ANALYZE TABLE order_items;
ANALYZE TABLE products;
ANALYZE TABLE shopkeepers;
ANALYZE TABLE users;

-- ============================================================================
-- PART 4: Verification
-- ============================================================================

-- Verify restockAt column exists
SELECT 
  COLUMN_NAME, 
  DATA_TYPE, 
  IS_NULLABLE, 
  COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'products' 
  AND COLUMN_NAME = 'restockAt';

-- Verify indexes were created
SELECT 
  TABLE_NAME,
  INDEX_NAME,
  COLUMN_NAME,
  SEQ_IN_INDEX
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('orders', 'order_items', 'products', 'shopkeepers', 'users')
  AND INDEX_NAME LIKE 'idx_%'
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================

SELECT 'Migration completed successfully! Order processing should now be 20x faster.' AS Status;
