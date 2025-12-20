-- ============================================
-- Delete Misspelled "choclates" Product
-- ============================================
-- This script safely removes the misspelled "choclates" product
-- while keeping the correctly spelled "chocolate" product
-- 
-- IMPORTANT: Run this on TiDB Cloud dashboard or production environment
-- ============================================

-- Step 1: View all chocolate products (for verification)
SELECT 
    id, 
    name, 
    shop_id, 
    price, 
    stock, 
    created_at,
    CASE 
        WHEN LOWER(name) LIKE '%choclate%' THEN '❌ MISSPELLED'
        WHEN LOWER(name) LIKE '%chocolate%' THEN '✅ CORRECT'
        ELSE '⚠️  OTHER'
    END as spelling_status
FROM products 
WHERE LOWER(name) LIKE '%choc%'
ORDER BY name;

-- Step 2: Check if misspelled product is used in orders
SELECT 
    p.id as product_id,
    p.name as product_name,
    COUNT(oi.id) as times_ordered,
    COUNT(DISTINCT oi.order_id) as unique_orders
FROM products p
LEFT JOIN order_items oi ON p.product_id = oi.product_id
WHERE LOWER(p.name) LIKE '%choclate%'
GROUP BY p.id, p.name;

-- Step 3: DELETE the misspelled product
-- ⚠️  CAUTION: This will permanently delete the product
-- Order history will be preserved (order_items remain)
DELETE FROM products 
WHERE LOWER(name) LIKE '%choclate%'
  AND LOWER(name) NOT LIKE '%chocolate%';

-- Step 4: Verify deletion - should only show correctly spelled products
SELECT 
    id, 
    name, 
    shop_id, 
    price, 
    stock
FROM products 
WHERE LOWER(name) LIKE '%choc%'
ORDER BY name;

-- ============================================
-- Expected Result:
-- - Misspelled "choclates" deleted
-- - Correctly spelled "chocolate" remains
-- - Order history preserved
-- ============================================
