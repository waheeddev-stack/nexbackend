-- ============================================================================
-- Service Status Tables Migration
-- ============================================================================
-- Creates service_status and service_status_history tables for service toggle control

-- Service Status Table
CREATE TABLE IF NOT EXISTS `service_status` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `status` ENUM('online', 'offline') NOT NULL DEFAULT 'online',
  `message` VARCHAR(500),
  `updated_by` INT,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_is_active` (`is_active`),
  INDEX `idx_updated_at` (`updated_at`),
  FOREIGN KEY (`updated_by`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default online status if table is empty
INSERT IGNORE INTO `service_status` (`status`, `message`, `is_active`, `created_at`, `updated_at`)
VALUES ('online', NULL, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Service Status History Table
CREATE TABLE IF NOT EXISTS `service_status_history` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `previous_status` ENUM('online', 'offline') NOT NULL,
  `new_status` ENUM('online', 'offline') NOT NULL,
  `message` VARCHAR(500),
  `changed_by` INT NOT NULL,
  `changed_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `ip_address` VARCHAR(45),
  `user_agent` VARCHAR(500),
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_changed_at` (`changed_at`),
  INDEX `idx_changed_by` (`changed_by`),
  INDEX `idx_new_status` (`new_status`),
  FOREIGN KEY (`changed_by`) REFERENCES `admins`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
