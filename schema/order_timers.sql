-- Order Timers Table for Pickup Code System
CREATE TABLE IF NOT EXISTS order_timers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  pickup_code VARCHAR(6) NOT NULL,
  timer_duration INT DEFAULT 420, -- 7 minutes in seconds
  timer_started_at TIMESTAMP NULL,
  timer_expires_at TIMESTAMP NULL,
  is_active BOOLEAN DEFAULT FALSE,
  is_expired BOOLEAN DEFAULT FALSE,
  stopped_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  UNIQUE KEY unique_order_timer (order_id),
  INDEX idx_pickup_code (pickup_code),
  INDEX idx_active_timers (is_active, timer_expires_at)
);

-- Add timer-related columns to orders table
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS has_timer BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS pickup_code VARCHAR(6) NULL,
ADD COLUMN IF NOT EXISTS timer_started_at TIMESTAMP NULL,
ADD COLUMN IF NOT EXISTS timer_expires_at TIMESTAMP NULL;

-- Create index for timer queries
CREATE INDEX IF NOT EXISTS idx_orders_timer ON orders(has_timer, timer_expires_at);