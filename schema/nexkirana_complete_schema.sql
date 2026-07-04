-- ============================================================================
-- NexKirana Complete Database Schema
-- ============================================================================
-- This consolidated schema includes all tables and modifications
-- Version: 1.0
-- Date: February 22, 2026
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: admins
-- Description: Admin users for the system
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `admins` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin AUTO_INCREMENT=60001;

-- ----------------------------------------------------------------------------
-- Table: users
-- Description: Customer/user accounts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(100) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `address` VARCHAR(255) DEFAULT NULL,
  `img` VARCHAR(255) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `expo_push_token` VARCHAR(255) DEFAULT NULL,
  `store_credits` INT(11) DEFAULT 0,
  `wallet` DECIMAL(10,2) DEFAULT 0,
  `latitude` DECIMAL(10,8) DEFAULT NULL,
  `longitude` DECIMAL(11,8) DEFAULT NULL,
  `refresh_token` VARCHAR(500) DEFAULT NULL,
  `referalcode` VARCHAR(10) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `referalcode` (`referalcode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin AUTO_INCREMENT=630001;

-- ----------------------------------------------------------------------------
-- Table: refer_transaction
-- Description: Records the refering transaction which have been made
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `refer_transaction`(
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `refererid` INT(11) NOT NULL,
  `referedid` INT(11) NOT NULL,
  `refered_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_referedid` (`referedid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- ----------------------------------------------------------------------------
-- Table: shopkeepers
-- Description: Shopkeeper/vendor accounts with subscription management
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `shopkeepers` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `shop_name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(100) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `address` VARCHAR(255) DEFAULT NULL,
  `img` VARCHAR(255) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `expo_push_token` VARCHAR(255) DEFAULT NULL,
  `upi_id` VARCHAR(100) DEFAULT NULL,
  `upi_qr` VARCHAR(255) DEFAULT NULL,
  `latitude` DECIMAL(10,8) DEFAULT NULL,
  `longitude` DECIMAL(11,8) DEFAULT NULL,
  `is_verified` TINYINT(1) DEFAULT 0,
  `refresh_token` VARCHAR(500) DEFAULT NULL,
  -- Online status
  `is_online` TINYINT(1) DEFAULT 1,
  -- Soft delete
  `is_deleted` TINYINT(1) DEFAULT 0,
  `deleted_at` DATETIME NULL,
  -- Subscription management
  `subscription_status` ENUM('active', 'overdue', 'grace_period', 'suspended') DEFAULT 'active',
  `last_payment_date` DATETIME NULL,
  `next_payment_due` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  INDEX `idx_shopkeepers_online` (`is_online`),
  INDEX `idx_is_deleted` (`is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin AUTO_INCREMENT=570001;

-- ============================================================================
-- PRODUCT TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: global_products
-- Description: Master product catalog (admin-managed)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `global_products` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `price` DECIMAL(10,2) NOT NULL,
  `category` VARCHAR(100) DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `image` VARCHAR(255) DEFAULT NULL,
  `barcode` VARCHAR(255) UNIQUE DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_barcode` (`barcode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin AUTO_INCREMENT=540001;

-- ----------------------------------------------------------------------------
-- Table: products
-- Description: Shop-specific products (linked to shopkeepers)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `products` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `shop_id` INT(11) DEFAULT NULL,
  `global_product_id` INT(11) DEFAULT NULL,
  `name` VARCHAR(150) DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `category` VARCHAR(100) DEFAULT NULL,
  `price` DECIMAL(10,2) DEFAULT NULL,
  `stock` INT(11) DEFAULT NULL,
  `image` VARCHAR(255) DEFAULT NULL,
  `barcode` VARCHAR(255) UNIQUE DEFAULT NULL,
  `baselineQty` INT DEFAULT 0 COMMENT 'Baseline quantity for auto-restock (set by shopkeeper)',
  `restockAt` DATETIME DEFAULT NULL COMMENT 'Scheduled time for next restock',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_shop_id` (`shop_id`),
  KEY `fk_global_product` (`global_product_id`),
  INDEX `idx_barcode` (`barcode`),
  INDEX `idx_restock_at` (`restockAt`),
  INDEX `idx_baseline_qty` (`baselineQty`),
  FOREIGN KEY (`shop_id`) REFERENCES `shopkeepers`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`global_product_id`) REFERENCES `global_products`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin AUTO_INCREMENT=600001;

-- ============================================================================
-- ORDER TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: orders
-- Description: Customer orders with timer and pickup functionality
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `orders` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `user_id` INT(11) NOT NULL,
  `shopkeeper_id` INT(11) NOT NULL,
  `status` ENUM('Pending','Processing','Delivered','Cancelled','Completed') DEFAULT 'Pending',
  `payment_method` ENUM('cod','upi') NOT NULL DEFAULT 'cod',
  `total_amount` DECIMAL(10,2) NOT NULL,
  `credits_earned` DECIMAL(10,2) DEFAULT 0,
  `credits_used` INT(11) NOT NULL DEFAULT 0,
  `credits_granted` TINYINT(1) NOT NULL DEFAULT 0,
  `latitude` DECIMAL(9,6) DEFAULT NULL,
  `longitude` DECIMAL(9,6) DEFAULT NULL,
  `delivery_address` VARCHAR(255) DEFAULT NULL,
  -- Scheduling and delivery mode
  `scheduled_time` DATETIME DEFAULT NULL COMMENT 'Scheduled pickup or delivery time',
  `order_type` VARCHAR(20) DEFAULT 'pickup' COMMENT 'Order type: pickup or delivery',
  `delivery_mode` VARCHAR(20) DEFAULT 'pickup' COMMENT 'Delivery mode: pickup or delivery',
  -- Timer functionality
  `has_timer` TINYINT(1) DEFAULT 0,
  `pickup_code` VARCHAR(10) DEFAULT NULL,
  `timer_started_at` DATETIME DEFAULT NULL,
  `timer_expires_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_user_id` (`user_id`),
  KEY `fk_shopkeeper_id` (`shopkeeper_id`),
  INDEX `idx_orders_pickup_code` (`pickup_code`),
  INDEX `idx_orders_timer` (`has_timer`, `timer_expires_at`),
  INDEX `idx_orders_scheduled` (`scheduled_time`),
  INDEX `idx_orders_delivery_mode` (`delivery_mode`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`shopkeeper_id`) REFERENCES `shopkeepers`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin AUTO_INCREMENT=2220001;

-- ----------------------------------------------------------------------------
-- Table: order_items
-- Description: Individual items within orders
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `order_items` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `order_id` INT(11) NOT NULL,
  `product_id` INT(11) NOT NULL,
  `quantity` INT(11) NOT NULL,
  `price` DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_order_id` (`order_id`),
  KEY `fk_product_id` (`product_id`),
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin AUTO_INCREMENT=1770001;

-- ----------------------------------------------------------------------------
-- Table: order_timers
-- Description: Timer tracking for pickup verification
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `order_timers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `pickup_code` VARCHAR(6) NOT NULL,
  `timer_duration` INT DEFAULT 420,
  `timer_started_at` TIMESTAMP NULL,
  `timer_expires_at` TIMESTAMP NULL,
  `is_active` BOOLEAN DEFAULT FALSE,
  `is_expired` BOOLEAN DEFAULT FALSE,
  `stopped_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_order_timer` (`order_id`),
  INDEX `idx_pickup_code` (`pickup_code`),
  INDEX `idx_active_timers` (`is_active`, `timer_expires_at`),
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- ============================================================================
-- INVENTORY MANAGEMENT TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: inventory_logs
-- Description: Audit trail for all stock changes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `inventory_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `product_id` INT NOT NULL,
  `shop_id` INT NOT NULL,
  `action` VARCHAR(50) NOT NULL COMMENT 'restock, sale, adjustment, return',
  `quantity` INT NOT NULL,
  `previous_stock` INT NOT NULL,
  `new_stock` INT NOT NULL,
  `performed_by` INT COMMENT 'User or shopkeeper ID who performed the action',
  `notes` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_product_id` (`product_id`),
  INDEX `idx_shop_id` (`shop_id`),
  INDEX `idx_created_at` (`created_at`),
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`shop_id`) REFERENCES `shopkeepers`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Table: price_history
-- Description: Track price changes over time
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `price_history` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `product_id` INT NOT NULL,
  `shop_id` INT NOT NULL,
  `old_price` DECIMAL(10, 2) NOT NULL,
  `new_price` DECIMAL(10, 2) NOT NULL,
  `changed_by` INT COMMENT 'User or shopkeeper ID who changed the price',
  `reason` VARCHAR(255),
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_product_id` (`product_id`),
  INDEX `idx_shop_id` (`shop_id`),
  INDEX `idx_created_at` (`created_at`),
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`shop_id`) REFERENCES `shopkeepers`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Table: inventory_alerts
-- Description: Low stock and inventory alerts configuration
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `inventory_alerts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `product_id` INT NOT NULL,
  `shop_id` INT NOT NULL,
  `alert_type` VARCHAR(50) NOT NULL COMMENT 'low_stock, out_of_stock, expiring_soon',
  `threshold_value` INT,
  `is_active` BOOLEAN DEFAULT TRUE,
  `last_triggered_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_product_id` (`product_id`),
  INDEX `idx_shop_id` (`shop_id`),
  INDEX `idx_is_active` (`is_active`),
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`shop_id`) REFERENCES `shopkeepers`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Table: barcode_scans
-- Description: Track barcode scanning activity
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `barcode_scans` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `barcode` VARCHAR(255) NOT NULL,
  `product_id` INT,
  `shop_id` INT,
  `scanned_by` INT COMMENT 'User or shopkeeper ID',
  `scan_result` VARCHAR(50) COMMENT 'found, not_found, error',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_barcode` (`barcode`),
  INDEX `idx_product_id` (`product_id`),
  INDEX `idx_shop_id` (`shop_id`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Table: stock_restoration_log
-- Description: Log stock restorations when orders are cancelled
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `stock_restoration_log` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `cancelled_by` VARCHAR(50) NOT NULL,
  `cancellation_reason` TEXT,
  `items_restored` INT DEFAULT 0,
  `total_quantity_restored` INT DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_order_id` (`order_id`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- BILLING & PAYMENT TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: billing_payments
-- Description: Shopkeeper subscription payments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `billing_payments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `shopkeeper_id` INT NOT NULL,
  `amount` DECIMAL(10, 2) NOT NULL,
  `payment_method` VARCHAR(50) DEFAULT 'upi',
  `transaction_id` VARCHAR(100),
  `payment_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `status` ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  `notes` TEXT,
  `approved_by` INT,
  `approved_at` DATETIME,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`shopkeeper_id`) REFERENCES `shopkeepers`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`approved_by`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  INDEX `idx_shopkeeper_id` (`shopkeeper_id`),
  INDEX `idx_status` (`status`),
  INDEX `idx_payment_date` (`payment_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Table: payment_info
-- Description: Admin payment credentials (UPI, bank details)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `payment_info` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `upi_id` VARCHAR(100),
  `upi_qr` VARCHAR(500),
  `bank_account` VARCHAR(50),
  `bank_name` VARCHAR(100),
  `ifsc_code` VARCHAR(20),
  `account_holder_name` VARCHAR(100),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- INDEXES & OPTIMIZATIONS
-- ============================================================================

-- Additional composite indexes for common queries
CREATE INDEX IF NOT EXISTS `idx_orders_user_status` ON `orders`(`user_id`, `status`);
CREATE INDEX IF NOT EXISTS `idx_orders_shopkeeper_status` ON `orders`(`shopkeeper_id`, `status`);
CREATE INDEX IF NOT EXISTS `idx_products_shop_category` ON `products`(`shop_id`, `category`);
-- Note: Location indexes removed due to TiDB key length limitation (max 3072 bytes)
-- Use separate indexes if needed: CREATE INDEX idx_latitude ON table(latitude);
-- CREATE INDEX IF NOT EXISTS `idx_shopkeepers_location` ON `shopkeepers`(`latitude`, `longitude`);
-- CREATE INDEX IF NOT EXISTS `idx_users_location` ON `users`(`latitude`, `longitude`);

-- ============================================================================
-- SERVICE STATUS TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: service_status
-- Description: Current service status (online/offline)
-- Only one active record at a time
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- Table: service_status_history
-- Description: Immutable audit trail of all service status changes
-- Retention: At least 1 year
-- ----------------------------------------------------------------------------
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

-- ============================================================================
-- FINAL SETTINGS
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
-- SCHEMA SUMMARY
-- ============================================================================
-- Core Tables: 3 (admins, users, shopkeepers)
-- Product Tables: 2 (global_products, products)
-- Order Tables: 3 (orders, order_items, order_timers)
-- Inventory Tables: 4 (inventory_logs, price_history, inventory_alerts, barcode_scans)
-- Billing Tables: 2 (billing_payments, payment_info)
-- Utility Tables: 1 (stock_restoration_log)
-- Refer Records Table: 1
-- Total Tables: 16
-- ============================================================================
