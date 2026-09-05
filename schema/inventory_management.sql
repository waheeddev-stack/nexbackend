-- Inventory Management Schema (Postgres / Neon)
-- Adds barcode scanning, price history, and inventory logging capabilities

-- Add barcode column to products table if it doesn't exist
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS barcode VARCHAR(255) UNIQUE;
CREATE INDEX IF NOT EXISTS idx_barcode ON products(barcode);

-- Add barcode column to global_products table if it doesn't exist
ALTER TABLE global_products
  ADD COLUMN IF NOT EXISTS barcode VARCHAR(255) UNIQUE;
CREATE INDEX IF NOT EXISTS idx_global_barcode ON global_products(barcode);

-- Create inventory_logs table for tracking stock changes
CREATE TABLE IF NOT EXISTS inventory_logs (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL,
  shop_id INT NOT NULL,
  action VARCHAR(50) NOT NULL, -- restock, sale, adjustment, return
  quantity INT NOT NULL,
  previous_stock INT NOT NULL,
  new_stock INT NOT NULL,
  performed_by INT, -- User or shopkeeper ID who performed the action
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_product_id ON inventory_logs(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_shop_id ON inventory_logs(shop_id);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_created_at ON inventory_logs(created_at);

-- Create price_history table for tracking price changes
CREATE TABLE IF NOT EXISTS price_history (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL,
  shop_id INT NOT NULL,
  old_price DECIMAL(10, 2) NOT NULL,
  new_price DECIMAL(10, 2) NOT NULL,
  changed_by INT, -- User or shopkeeper ID who changed the price
  reason VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_price_history_product_id ON price_history(product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_shop_id ON price_history(shop_id);
CREATE INDEX IF NOT EXISTS idx_price_history_created_at ON price_history(created_at);

-- Create inventory_alerts table for low stock notifications
CREATE TABLE IF NOT EXISTS inventory_alerts (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL,
  shop_id INT NOT NULL,
  alert_type VARCHAR(50) NOT NULL, -- low_stock, out_of_stock, expiring_soon
  threshold_value INT,
  is_active BOOLEAN DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_inventory_alerts_product_id ON inventory_alerts(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_alerts_shop_id ON inventory_alerts(shop_id);
CREATE INDEX IF NOT EXISTS idx_inventory_alerts_is_active ON inventory_alerts(is_active);

-- Create barcode_scans table for tracking scan activity
CREATE TABLE IF NOT EXISTS barcode_scans (
  id SERIAL PRIMARY KEY,
  barcode VARCHAR(255) NOT NULL,
  product_id INT,
  shop_id INT,
  scanned_by INT, -- User or shopkeeper ID
  scan_result VARCHAR(50), -- found, not_found, error
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_barcode_scans_barcode ON barcode_scans(barcode);
CREATE INDEX IF NOT EXISTS idx_barcode_scans_product_id ON barcode_scans(product_id);
CREATE INDEX IF NOT EXISTS idx_barcode_scans_shop_id ON barcode_scans(shop_id);
CREATE INDEX IF NOT EXISTS idx_barcode_scans_created_at ON barcode_scans(created_at);
