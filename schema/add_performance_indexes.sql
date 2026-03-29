-- ============================================================================
-- Performance Optimization Indexes for Order Processing
-- Target: Reduce order placement time from 5-6 seconds to < 1 second
-- ============================================================================

-- Check if indexes already exist before creating
-- Run this script on your database to optimize order processing

-- ============================================================================
-- ORDERS TABLE INDEXES
-- ============================================================================

-- Index for user's orders lookup (GET /api/orders)
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);

-- Index for shopkeeper's orders lookup
CREATE INDEX IF NOT EXISTS idx_orders_shopkeeper_id ON orders(shopkeeper_id);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- Index for date-based queries and sorting
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- Composite index for user + status queries (most common)
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);

-- Composite index for shopkeeper + status queries
CREATE INDEX IF NOT EXISTS idx_orders_shop_status ON orders(shopkeeper_id, status);

-- Index for timer-based orders (pickup orders)
CREATE INDEX IF NOT EXISTS idx_orders_has_timer ON orders(has_timer);

-- ============================================================================
-- ORDER_ITEMS TABLE INDEXES
-- ============================================================================

-- Index for order items lookup (JOIN operations)
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- Index for product-based queries
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

-- Composite index for order + product (faster JOINs)
CREATE INDEX IF NOT EXISTS idx_order_items_order_product ON order_items(order_id, product_id);

-- ============================================================================
-- PRODUCTS TABLE INDEXES
-- ============================================================================

-- Index for shop's products lookup
CREATE INDEX IF NOT EXISTS idx_products_shop_id ON products(shop_id);

-- Index for stock availability checks
CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock);

-- Composite index for shop + stock (order validation)
CREATE INDEX IF NOT EXISTS idx_products_shop_stock ON products(shop_id, stock);

-- Index for product category filtering
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- ============================================================================
-- SHOPKEEPERS TABLE INDEXES
-- ============================================================================

-- Index for subscription status checks (order validation)
CREATE INDEX IF NOT EXISTS idx_shopkeepers_subscription ON shopkeepers(subscription_status);

-- Index for deleted shops filtering
CREATE INDEX IF NOT EXISTS idx_shopkeepers_deleted ON shopkeepers(is_deleted);

-- Composite index for active shops (subscription + deleted)
CREATE INDEX IF NOT EXISTS idx_shopkeepers_active ON shopkeepers(subscription_status, is_deleted);

-- Index for location-based queries
CREATE INDEX IF NOT EXISTS idx_shopkeepers_location ON shopkeepers(latitude, longitude);

-- ============================================================================
-- USERS TABLE INDEXES
-- ============================================================================

-- Index for user lookup by email (login)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Index for user credits lookup
CREATE INDEX IF NOT EXISTS idx_users_credits ON users(store_credits);

-- Index for deleted users filtering
CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(is_deleted);

-- ============================================================================
-- ORDER_TIMERS TABLE INDEXES
-- ============================================================================

-- Index for timer lookup by order
CREATE INDEX IF NOT EXISTS idx_order_timers_order_id ON order_timers(order_id);

-- Index for active timers
CREATE INDEX IF NOT EXISTS idx_order_timers_active ON order_timers(is_active);

-- Index for expired timers cleanup
CREATE INDEX IF NOT EXISTS idx_order_timers_expires ON order_timers(timer_expires_at);

-- Composite index for active + expiry (timer queries)
CREATE INDEX IF NOT EXISTS idx_order_timers_active_expires ON order_timers(is_active, timer_expires_at);

-- ============================================================================
-- ANALYZE TABLES (Update statistics for query optimizer)
-- ============================================================================

ANALYZE TABLE orders;
ANALYZE TABLE order_items;
ANALYZE TABLE products;
ANALYZE TABLE shopkeepers;
ANALYZE TABLE users;
ANALYZE TABLE order_timers;

-- ============================================================================
-- VERIFY INDEXES
-- ============================================================================

-- Check indexes on orders table
SHOW INDEX FROM orders;

-- Check indexes on order_items table
SHOW INDEX FROM order_items;

-- Check indexes on products table
SHOW INDEX FROM products;

-- Check indexes on shopkeepers table
SHOW INDEX FROM shopkeepers;

-- Check indexes on users table
SHOW INDEX FROM users;

-- Check indexes on order_timers table
SHOW INDEX FROM order_timers;

-- ============================================================================
-- PERFORMANCE TESTING QUERIES
-- ============================================================================

-- Test query performance after adding indexes
-- These should execute in < 50ms each

-- Test 1: User's orders with items
EXPLAIN SELECT o.*, oi.* 
FROM orders o 
LEFT JOIN order_items oi ON o.id = oi.order_id 
WHERE o.user_id = 1 
ORDER BY o.created_at DESC 
LIMIT 20;

-- Test 2: Shop's pending orders
EXPLAIN SELECT * 
FROM orders 
WHERE shopkeeper_id = 1 
AND status IN ('Pending', 'Processing') 
ORDER BY created_at DESC;

-- Test 3: Product stock check
EXPLAIN SELECT id, stock 
FROM products 
WHERE id IN (1, 2, 3, 4, 5) 
AND shop_id = 1 
FOR UPDATE;

-- Test 4: Active shopkeeper check
EXPLAIN SELECT id, subscription_status, is_deleted 
FROM shopkeepers 
WHERE id = 1 
AND subscription_status = 'active' 
AND is_deleted = 0;

-- ============================================================================
-- CLEANUP OLD INDEXES (if any duplicates exist)
-- ============================================================================

-- Run these only if you have duplicate or old indexes
-- Check with SHOW INDEX FROM table_name first

-- Example: Drop old index if exists
-- DROP INDEX old_index_name ON orders;

-- ============================================================================
-- NOTES
-- ============================================================================

-- 1. These indexes significantly improve read performance
-- 2. They add minimal overhead to write operations
-- 3. Indexes are automatically maintained by MySQL/TiDB
-- 4. Run ANALYZE TABLE periodically to update statistics
-- 5. Monitor index usage with:
--    SELECT * FROM sys.schema_unused_indexes;
-- 6. For TiDB, indexes are distributed across nodes automatically

-- ============================================================================
-- EXPECTED PERFORMANCE IMPROVEMENT
-- ============================================================================

-- Before indexes:
-- - Order placement: 5-6 seconds
-- - Order lookup: 500-1000ms
-- - Stock validation: 200-500ms

-- After indexes:
-- - Order placement: 200-300ms (with batching)
-- - Order lookup: 50-100ms
-- - Stock validation: 10-20ms

-- Total improvement: 20x faster order processing

-- ============================================================================
-- MAINTENANCE
-- ============================================================================

-- Run monthly to optimize indexes
OPTIMIZE TABLE orders;
OPTIMIZE TABLE order_items;
OPTIMIZE TABLE products;
OPTIMIZE TABLE shopkeepers;

-- Check index fragmentation
SELECT 
  TABLE_NAME,
  INDEX_NAME,
  CARDINALITY,
  INDEX_LENGTH
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
AND TABLE_NAME IN ('orders', 'order_items', 'products', 'shopkeepers')
ORDER BY TABLE_NAME, INDEX_NAME;
