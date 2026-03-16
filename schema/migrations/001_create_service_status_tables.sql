-- ============================================================================
-- Service Toggle Control Migration
-- ============================================================================
-- Creates service_status and service_status_history tables for service toggle feature
-- Date: February 27, 2026
-- ============================================================================

-- ============================================================================
-- Table: service_status
-- Description: Current service status (online/offline)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `service_status` (
  `id` CHAR(36) NOT NULL COMMENT 'UUID primary key',
  `status` ENUM('online', 'offline') NOT NULL DEFAULT 'online' COMMENT 'Current service status',
  `message` TEXT DEFAULT NULL COMMENT 'Optional admin message (max 500 chars)',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Record creation timestamp (UTC)',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last update timestamp (UTC)',
  `updated_by` INT(11) NOT NULL COMMENT 'Foreign key to admin user who made the change',
  `is_active` TINYINT(1) DEFAULT 1 COMMENT 'Soft delete flag - only one active record at a time',
  
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`) COMMENT 'Index for fast status queries',
  KEY `idx_is_active` (`is_active`) COMMENT 'Index for finding current active status',
  KEY `idx_updated_by` (`updated_by`) COMMENT 'Index for audit queries by admin',
  CONSTRAINT `fk_service_status_admin` FOREIGN KEY (`updated_by`) REFERENCES `admins` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Service status table - stores current online/offline state';

-- ============================================================================
-- Table: service_status_history
-- Description: Immutable audit log of all service status changes
-- ============================================================================
CREATE TABLE IF NOT EXISTS `service_status_history` (
  `id` CHAR(36) NOT NULL COMMENT 'UUID primary key',
  `service_status_id` CHAR(36) NOT NULL COMMENT 'Foreign key to service_status',
  `previous_status` ENUM('online', 'offline') NOT NULL COMMENT 'Status before change',
  `new_status` ENUM('online', 'offline') NOT NULL COMMENT 'Status after change',
  `message` TEXT DEFAULT NULL COMMENT 'Admin message provided during toggle',
  `changed_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'When the change occurred (UTC)',
  `changed_by` INT(11) NOT NULL COMMENT 'Foreign key to admin user who made the change',
  `ip_address` VARCHAR(45) DEFAULT NULL COMMENT 'Client IP address (IPv4 or IPv6)',
  `user_agent` VARCHAR(500) DEFAULT NULL COMMENT 'User agent string from request',
  
  PRIMARY KEY (`id`),
  KEY `idx_changed_at` (`changed_at`) COMMENT 'Index for time-based queries',
  KEY `idx_changed_by` (`changed_by`) COMMENT 'Index for audit queries by admin',
  KEY `idx_service_status_id` (`service_status_id`) COMMENT 'Index for finding history of specific status',
  CONSTRAINT `fk_history_service_status` FOREIGN KEY (`service_status_id`) REFERENCES `service_status` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_history_admin` FOREIGN KEY (`changed_by`) REFERENCES `admins` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Immutable audit log of service status changes';

-- ============================================================================
-- Initial Data
-- ============================================================================
-- Insert initial service status record (service is online by default)
-- Note: Replace 'admin-id-here' with actual admin ID from your system
-- This should be run after the first admin is created
-- ============================================================================

-- Uncomment and update the admin ID before running:
-- INSERT INTO `service_status` (
--   `id`,
--   `status`,
--   `message`,
--   `created_at`,
--   `updated_at`,
--   `updated_by`,
--   `is_active`
-- ) VALUES (
--   UUID(),
--   'online',
--   NULL,
--   CURRENT_TIMESTAMP,
--   CURRENT_TIMESTAMP,
--   1,
--   1
-- );

-- ============================================================================
-- Migration Complete
-- ============================================================================
