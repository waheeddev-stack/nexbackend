-- Database Schema for NexKirana
-- Version: 2.1 (Postgres / Neon)
-- Generated from Documentation
-- NOTE: This file is now Postgres-compatible. For MySQL/TiDB history see schema/archive/.

CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  address VARCHAR(255),
  img VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expo_push_token VARCHAR(255),
  store_credits INT DEFAULT 0,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  refresh_token VARCHAR(500)
);

CREATE TABLE IF NOT EXISTS shopkeepers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  shop_name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  address VARCHAR(255),
  img VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expo_push_token VARCHAR(255),
  upi_id VARCHAR(100),
  upi_qr VARCHAR(255),
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  is_verified SMALLINT DEFAULT NULL,
  refresh_token VARCHAR(500),
  is_online SMALLINT DEFAULT 1,
  is_deleted SMALLINT DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  subscription_status VARCHAR(20) DEFAULT 'active' CHECK (subscription_status IN ('active','overdue','grace_period','suspended')),
  last_payment_date TIMESTAMPTZ,
  next_payment_due TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS global_products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  category VARCHAR(100),
  description TEXT,
  image VARCHAR(255),
  barcode VARCHAR(255) UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  shop_id INT NOT NULL,
  global_product_id INT,
  name VARCHAR(150),
  description TEXT,
  category VARCHAR(100),
  price DECIMAL(10,2),
  mrp DECIMAL(10,2) DEFAULT NULL,
  stock INT DEFAULT 0,
  image VARCHAR(255),
  barcode VARCHAR(255) UNIQUE,
  baselineQty INT DEFAULT 0,
  restockAt TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (shop_id) REFERENCES shopkeepers(id) ON DELETE CASCADE,
  FOREIGN KEY (global_product_id) REFERENCES global_products(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  shopkeeper_id INT NOT NULL,
  status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending','Processing','Delivered','Cancelled','Completed')),
  payment_method VARCHAR(10) NOT NULL DEFAULT 'cod' CHECK (payment_method IN ('cod','upi')),
  total_amount DECIMAL(10,2) NOT NULL,
  credits_earned DECIMAL(10,2) DEFAULT 0,
  credits_used INT NOT NULL DEFAULT 0,
  credits_granted SMALLINT NOT NULL DEFAULT 0,
  latitude DECIMAL(9,6),
  longitude DECIMAL(9,6),
  delivery_address VARCHAR(255),
  scheduled_time TIMESTAMPTZ,
  order_type VARCHAR(20) DEFAULT 'pickup',
  delivery_mode VARCHAR(20) DEFAULT 'pickup',
  has_timer SMALLINT DEFAULT 0,
  pickup_code VARCHAR(10),
  timer_started_at TIMESTAMPTZ,
  timer_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (shopkeeper_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_timers (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL UNIQUE,
  pickup_code VARCHAR(6) NOT NULL,
  timer_duration INT DEFAULT 420,
  timer_started_at TIMESTAMPTZ,
  timer_expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT FALSE,
  is_expired BOOLEAN DEFAULT FALSE,
  stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventory_logs (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL,
  shop_id INT NOT NULL,
  action VARCHAR(50) NOT NULL,
  quantity INT NOT NULL,
  previous_stock INT NOT NULL,
  new_stock INT NOT NULL,
  performed_by INT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS price_history (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL,
  shop_id INT NOT NULL,
  old_price DECIMAL(10,2) NOT NULL,
  new_price DECIMAL(10,2) NOT NULL,
  changed_by INT,
  reason VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventory_alerts (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL,
  shop_id INT NOT NULL,
  alert_type VARCHAR(50) NOT NULL,
  threshold_value INT,
  is_active BOOLEAN DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS barcode_scans (
  id SERIAL PRIMARY KEY,
  barcode VARCHAR(255) NOT NULL,
  product_id INT,
  shop_id INT,
  scanned_by INT,
  scan_result VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_restoration_log (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL,
  cancelled_by VARCHAR(50) NOT NULL,
  cancellation_reason TEXT,
  items_restored INT DEFAULT 0,
  total_quantity_restored INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_payments (
  id SERIAL PRIMARY KEY,
  shopkeeper_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  payment_method VARCHAR(50) DEFAULT 'upi',
  transaction_id VARCHAR(100),
  payment_date TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(10) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  notes TEXT,
  approved_by INT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (shopkeeper_id) REFERENCES shopkeepers(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES admins(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payment_info (
  id SERIAL PRIMARY KEY,
  upi_id VARCHAR(100),
  upi_qr VARCHAR(500),
  bank_account VARCHAR(50),
  bank_name VARCHAR(100),
  ifsc_code VARCHAR(20),
  account_holder_name VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_status (
  id SERIAL PRIMARY KEY,
  status VARCHAR(10) NOT NULL DEFAULT 'online' CHECK (status IN ('online','offline')),
  message VARCHAR(500),
  updated_by INT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (updated_by) REFERENCES admins(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS service_status_history (
  id SERIAL PRIMARY KEY,
  previous_status VARCHAR(10) NOT NULL CHECK (previous_status IN ('online','offline')),
  new_status VARCHAR(10) NOT NULL CHECK (new_status IN ('online','offline')),
  message VARCHAR(500),
  changed_by INT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address VARCHAR(45),
  user_agent VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (changed_by) REFERENCES admins(id) ON DELETE RESTRICT
);

-- Helper used by the trigger loop above (must be created BEFORE the loop)
CREATE OR REPLACE FUNCTION column_name_exists(tbl TEXT, col TEXT) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=tbl AND column_name=col
  );
END;
$$ LANGUAGE plpgsql;

-- updated_at auto-touch trigger (replaces MySQL ON UPDATE CURRENT_TIMESTAMP)
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.tables
           WHERE table_schema='public' AND table_type='BASE TABLE'
             AND column_name_exists(table_name, 'updated_at')
  LOOP
    BEGIN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', t, t);
      EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t, t);
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;
END $$;
