-- ============================================================================
-- Google OAuth Migration
-- ============================================================================
-- Adds google_id column to users and shopkeepers tables for OAuth support
-- Date: February 27, 2026
-- ============================================================================

-- Add google_id to users table
ALTER TABLE `users` 
ADD COLUMN `google_id` VARCHAR(255) DEFAULT NULL AFTER `email`;

-- Add google_id to shopkeepers table
ALTER TABLE `shopkeepers` 
ADD COLUMN `google_id` VARCHAR(255) DEFAULT NULL AFTER `email`;

-- Add unique constraints
ALTER TABLE `users` 
ADD UNIQUE KEY `unique_google_id_users` (`google_id`);

ALTER TABLE `shopkeepers` 
ADD UNIQUE KEY `unique_google_id_shopkeepers` (`google_id`);

-- Add indexes for faster lookups
CREATE INDEX `idx_users_google_id` ON `users`(`google_id`);
CREATE INDEX `idx_shopkeepers_google_id` ON `shopkeepers`(`google_id`);

-- ============================================================================
-- Migration Complete
-- ============================================================================
