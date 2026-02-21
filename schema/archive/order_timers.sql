-- First, let's check and create the orders table if it doesn't exist
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  shopkeeper_id INT NOT NULL,
  status ENUM('Pending','Processing','Delivered','Cancelled') DEFAULT 'Pending',
  total_amount DECIMAL(10,2) NOT NULL,
  points_discount DECIMAL(10,2) DEFAULT 0.00,
  credits_earned DECIMAL(10,2) DEFAULT 0,
  latitude DECIMAL(9,6),
  longitude DECIMAL(9,6),
  delivery_address VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add timer-related columns to orders table (safe to run multiple times)
SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'orders' 
   AND COLUMN_NAME = 'has_timer') = 0,
  'ALTER TABLE orders ADD COLUMN has_timer BOOLEAN DEFAULT FALSE',
  'SELECT "has_timer column already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'orders' 
   AND COLUMN_NAME = 'pickup_code') = 0,
  'ALTER TABLE orders ADD COLUMN pickup_code VARCHAR(6) NULL',
  'SELECT "pickup_code column already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'orders' 
   AND COLUMN_NAME = 'timer_started_at') = 0,
  'ALTER TABLE orders ADD COLUMN timer_started_at TIMESTAMP NULL',
  'SELECT "timer_started_at column already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'orders' 
   AND COLUMN_NAME = 'timer_expires_at') = 0,
  'ALTER TABLE orders ADD COLUMN timer_expires_at TIMESTAMP NULL',
  'SELECT "timer_expires_at column already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Now create the order_timers table with proper data type matching
DROP TABLE IF EXISTS order_timers;

CREATE TABLE order_timers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  pickup_code VARCHAR(6) NOT NULL,
  timer_duration INT DEFAULT 420,
  timer_started_at TIMESTAMP NULL,
  timer_expires_at TIMESTAMP NULL,
  is_active BOOLEAN DEFAULT FALSE,
  is_expired BOOLEAN DEFAULT FALSE,
  stopped_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_order_timer (order_id),
  INDEX idx_pickup_code (pickup_code),
  INDEX idx_active_timers (is_active, timer_expires_at)
);

-- Add foreign key constraint after ensuring compatibility
ALTER TABLE order_timers 
ADD CONSTRAINT fk_order_timers_order_id 
FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

-- Create index for timer queries on orders table
CREATE INDEX IF NOT EXISTS idx_orders_timer ON orders(has_timer, timer_expires_at);