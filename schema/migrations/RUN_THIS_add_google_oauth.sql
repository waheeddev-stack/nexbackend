-- ============================================================================
-- Google OAuth Migration - MANUAL EXECUTION
-- ============================================================================
-- Run this script in your MySQL database to add Google OAuth support
-- Date: March 8, 2026
-- ============================================================================

USE nexkiranadb;

-- Step 1: Add google_id column to users table
ALTER TABLE `users` 
ADD COLUMN `google_id` VARCHAR(255) DEFAULT NULL AFTER `email`;

-- Step 2: Add google_id column to shopkeepers table
ALTER TABLE `shopkeepers` 
ADD COLUMN `google_id` VARCHAR(255) DEFAULT NULL AFTER `email`;

-- Step 3: Add unique constraints
ALTER TABLE `users` 
ADD UNIQUE KEY `unique_google_id_users` (`google_id`);

ALTER TABLE `shopkeepers` 
ADD UNIQUE KEY `unique_google_id_shopkeepers` (`google_id`);

-- Step 4: Add indexes for faster lookups
CREATE INDEX `idx_users_google_id` ON `users`(`google_id`);
CREATE INDEX `idx_shopkeepers_google_id` ON `shopkeepers`(`google_id`);

-- ============================================================================
-- Verification Queries (run these to verify the migration)
-- ============================================================================

-- Check if google_id column exists in users table
SHOW COLUMNS FROM users WHERE Field = 'google_id';

-- Check if google_id column exists in shopkeepers table
SHOW COLUMNS FROM shopkeepers WHERE Field = 'google_id';

-- Check indexes
SHOW INDEX FROM users WHERE Key_name LIKE '%google%';
SHOW INDEX FROM shopkeepers WHERE Key_name LIKE '%google%';

-- ============================================================================
-- Migration Complete!
-- ============================================================================
-- You can now use Google OAuth for authentication
-- The google_id column will store the unique Google user ID
-- ============================================================================
