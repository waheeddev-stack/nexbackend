-- ============================================================================
-- Shopping Lists Table Migration
-- ============================================================================
-- Creates shopping_lists table to store customer written list text and uploaded image URLs
-- Date: July 12, 2026

CREATE TABLE IF NOT EXISTS `shopping_lists` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `items` TEXT DEFAULT NULL,
  `image_url` VARCHAR(255) DEFAULT NULL,
  `cloudinary_public_id` VARCHAR(255) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_created_at` (`created_at`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
