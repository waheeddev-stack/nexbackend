-- Fix AUTO_INCREMENT issue on shopkeepers table
-- This script resets the AUTO_INCREMENT to start from the next available ID

-- Step 1: Find the current maximum ID
SELECT MAX(id) as max_id FROM shopkeepers;

-- Step 2: Set AUTO_INCREMENT to max_id + 1
-- Replace <MAX_ID> with the value from step 1, plus 1
-- For example, if max_id is 78, use 79
ALTER TABLE shopkeepers AUTO_INCREMENT = 79;

-- Step 3: Verify the change
SHOW TABLE STATUS LIKE 'shopkeepers';

-- Step 4: Delete any shopkeepers with id = 0 or NULL (these are broken)
DELETE FROM shopkeepers WHERE id = 0 OR id IS NULL;

-- Step 5: Verify deletion
SELECT COUNT(*) as deleted_count FROM shopkeepers WHERE id = 0 OR id IS NULL;
