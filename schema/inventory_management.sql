-- Inventory Management Schema
-- Adds barcode scanning, price history, and inventory logging capabilities

-- Add barcode column to products table if it doesn't exist
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS barcode VARCHAR(255) UNIQUE,
ADD INDEX IF NOT EXISTS idx_barcode (barcode);

-- Add barcode column to global_products table if it doesn't exist  
ALTER TABLE global_products
ADD COLUMN IF NOT EXISTS barcode VARCHAR(255) UNIQUE,
ADD INDEX IF NOT EXISTS idx_barcode (barcode);

-- Create inventory_logs table for tracking stock changes
CREATE TABLE IF NOT EXISTS inventory_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  shop_id INT NOT NULL,
  action VARCHAR(50) NOT NULL COMMENT 'restock, sale, adjustment, return',
  quantity INT NOT NULL,
  previous_stock INT NOT NULL,
  new_stock INT NOT NULL,
  performed_by INT COMMENT 'User or shopkeeper ID who performed the action',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_product_id (product_id),
  INDEX idx_shop_id (shop_id),
  INDEX idx_created_at (created_at),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create price_history table for tracking price changes
CREATE TABLE IF NOT EXISTS price_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  shop_id INT NOT NULL,
  old_price DECIMAL(10, 2) NOT NULL,
  new_price DECIMAL(10, 2) NOT NULL,
  changed_by INT COMMENT 'User or shopkeeper ID who changed the price',
  reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_product_id (product_id),
  INDEX idx_shop_id (shop_id),
  INDEX idx_created_at (created_at),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create inventory_alerts table for low stock notifications
CREATE TABLE IF NOT EXISTS inventory_alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  shop_id INT NOT NULL,
  alert_type VARCHAR(50) NOT NULL COMMENT 'low_stock, out_of_stock, expiring_soon',
  threshold_value INT,
  is_active BOOLEAN DEFAULT TRUE,
  last_triggered_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_product_id (product_id),
  INDEX idx_shop_id (shop_id),
  INDEX idx_is_active (is_active),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create barcode_scans table for tracking scan activity
CREATE TABLE IF NOT EXISTS barcode_scans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  barcode VARCHAR(255) NOT NULL,
  product_id INT,
  shop_id INT,
  scanned_by INT COMMENT 'User or shopkeeper ID',
  scan_result VARCHAR(50) COMMENT 'found, not_found, error',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_barcode (barcode),
  INDEX idx_product_id (product_id),
  INDEX idx_shop_id (shop_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
