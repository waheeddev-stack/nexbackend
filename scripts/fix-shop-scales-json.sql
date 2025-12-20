-- Fix shop_scales column to contain valid JSON arrays instead of plain text
-- This will convert text values like "all" and "medium" to proper JSON arrays

-- Update "all" to ["all"]
UPDATE products 
SET shop_scales = '["all"]' 
WHERE shop_scales = 'all' OR shop_scales = '"all"';

-- Update "medium" to ["medium"]
UPDATE products 
SET shop_scales = '["medium"]' 
WHERE shop_scales = 'medium' OR shop_scales = '"medium"';

-- Update "small" to ["small"]
UPDATE products 
SET shop_scales = '["small"]' 
WHERE shop_scales = 'small' OR shop_scales = '"small"';

-- Update "large" to ["large"]
UPDATE products 
SET shop_scales = '["large"]' 
WHERE shop_scales = 'large' OR shop_scales = '"large"';

-- Set NULL values to default ["all"]
UPDATE products 
SET shop_scales = '["all"]' 
WHERE shop_scales IS NULL;

-- Verify the fix
SELECT id, name, shop_scales 
FROM products 
WHERE shop_scales NOT LIKE '[%]'
LIMIT 20;

-- If the above query returns no results, all shop_scales are now valid JSON arrays
