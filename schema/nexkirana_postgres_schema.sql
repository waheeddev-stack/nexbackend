-- ============================================================================
-- NexKirana Postgres Schema (Neon) — AUTO_INCREMENT starts at 1
-- ============================================================================
-- Use this schema when deploying to Neon Postgres.
-- All identity columns start at 1 (RESTART WITH 1).
-- MySQL backticks / ENGINE clauses have been removed.
-- Generated from nexkirana_complete_schema.sql
-- Date: 2026-09-01
-- ============================================================================

-- Enable UUID extension if needed (optional)
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- Table: admins
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Table: users
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(20) DEFAULT NULL,
  address VARCHAR(255) DEFAULT NULL,
  img VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expo_push_token VARCHAR(255) DEFAULT NULL,
  store_credits INTEGER DEFAULT 0,
  wallet DECIMAL(10,2) DEFAULT 0,
  latitude DECIMAL(10,8) DEFAULT NULL,
  longitude DECIMAL(11,8) DEFAULT NULL,
  refresh_token VARCHAR(500) DEFAULT NULL,
  referralcode VARCHAR(10) DEFAULT NULL UNIQUE,
  area VARCHAR(100) DEFAULT NULL,
  landmark VARCHAR(255) DEFAULT NULL,
  pincode VARCHAR(20) DEFAULT NULL,
  google_id VARCHAR(255) DEFAULT NULL,
  zeu_id VARCHAR(100) DEFAULT NULL
);

-- ----------------------------------------------------------------------------
-- Table: refer_transaction
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refer_transaction(
  id SERIAL PRIMARY KEY,
  refererid INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referedid INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  refered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refererid ON refer_transaction(refererid);

-- ----------------------------------------------------------------------------
-- Table: shopkeepers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shopkeepers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  shop_name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(20) DEFAULT NULL,
  address VARCHAR(255) DEFAULT NULL,
  img VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expo_push_token VARCHAR(255) DEFAULT NULL,
  upi_id VARCHAR(100) DEFAULT NULL,
  upi_qr VARCHAR(255) DEFAULT NULL,
  latitude DECIMAL(10,8) DEFAULT NULL,
  longitude DECIMAL(11,8) DEFAULT NULL,
  is_verified SMALLINT DEFAULT 0,
  refresh_token VARCHAR(500) DEFAULT NULL,
  is_online SMALLINT DEFAULT 1,
  is_deleted SMALLINT DEFAULT 0,
  deleted_at TIMESTAMPTZ NULL,
  subscription_status VARCHAR(20) DEFAULT 'active' CHECK (subscription_status IN ('active','overdue','grace_period','suspended')),
  last_payment_date TIMESTAMPTZ NULL,
  next_payment_due TIMESTAMPTZ NULL,
  grace_period_end TIMESTAMPTZ NULL,
  shop_scale VARCHAR(20) DEFAULT NULL,
  home_delivery_active SMALLINT DEFAULT 1,
  google_id VARCHAR(255) DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_shopkeepers_online ON shopkeepers(is_online);
CREATE INDEX IF NOT EXISTS idx_is_deleted ON shopkeepers(is_deleted);

-- ----------------------------------------------------------------------------
-- Table: global_products
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS global_products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  category VARCHAR(100) DEFAULT NULL,
  description TEXT DEFAULT NULL,
  image VARCHAR(255) DEFAULT NULL,
  barcode VARCHAR(255) UNIQUE DEFAULT NULL,
  shop_scales JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_barcode_global ON global_products(barcode);

-- ----------------------------------------------------------------------------
-- Table: products
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER REFERENCES shopkeepers(id) ON DELETE CASCADE,
  global_product_id INTEGER REFERENCES global_products(id) ON DELETE SET NULL,
  name VARCHAR(150) DEFAULT NULL,
  description TEXT DEFAULT NULL,
  category VARCHAR(100) DEFAULT NULL,
  price DECIMAL(10,2) DEFAULT NULL,
  mrp DECIMAL(10,2) DEFAULT NULL,
  stock INTEGER DEFAULT NULL,
  image VARCHAR(255) DEFAULT NULL,
  images TEXT DEFAULT NULL,
  barcode VARCHAR(255) UNIQUE DEFAULT NULL,
  baselineQty INTEGER DEFAULT 0,
  restockAt TIMESTAMPTZ DEFAULT NULL,
  available_stock VARCHAR(20) DEFAULT NULL,
  is_visible SMALLINT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_shop_category ON products(shop_id, category);
CREATE INDEX IF NOT EXISTS idx_restock_at ON products(restockAt);

-- ----------------------------------------------------------------------------
-- Table: orders
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shopkeeper_id INTEGER NOT NULL REFERENCES shopkeepers(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending','Processing','Delivered','Cancelled','Completed')),
  payment_method VARCHAR(20) NOT NULL DEFAULT 'cod' CHECK (payment_method IN ('cod','upi')),
  total_amount DECIMAL(10,2) NOT NULL,
  credits_earned DECIMAL(10,2) DEFAULT 0,
  credits_used INTEGER NOT NULL DEFAULT 0,
  credits_granted SMALLINT NOT NULL DEFAULT 0,
  instant_discount DECIMAL(10,2) DEFAULT 0.00,
  latitude DECIMAL(9,6) DEFAULT NULL,
  longitude DECIMAL(9,6) DEFAULT NULL,
  delivery_address VARCHAR(255) DEFAULT NULL,
  scheduled_time TIMESTAMPTZ DEFAULT NULL,
  order_type VARCHAR(20) DEFAULT 'pickup',
  delivery_mode VARCHAR(20) DEFAULT 'pickup',
  has_timer SMALLINT DEFAULT 0,
  pickup_code VARCHAR(10) DEFAULT NULL,
  timer_started_at TIMESTAMPTZ DEFAULT NULL,
  timer_expires_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_shopkeeper_status ON orders(shopkeeper_id, status);

-- ----------------------------------------------------------------------------
-- Table: order_items
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  price DECIMAL(10,2) NOT NULL
);

-- ----------------------------------------------------------------------------
-- Table: order_timers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_timers (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  pickup_code VARCHAR(6) NOT NULL,
  timer_duration INTEGER DEFAULT 420,
  timer_started_at TIMESTAMPTZ,
  timer_expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT FALSE,
  is_expired BOOLEAN DEFAULT FALSE,
  stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Tables: inventory_logs, price_history, inventory_alerts, barcode_scans, stock_restoration_log
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_logs (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  shop_id INTEGER NOT NULL REFERENCES shopkeepers(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  quantity INTEGER NOT NULL,
  previous_stock INTEGER NOT NULL,
  new_stock INTEGER NOT NULL,
  performed_by INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS price_history (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  shop_id INTEGER NOT NULL REFERENCES shopkeepers(id) ON DELETE CASCADE,
  old_price DECIMAL(10, 2) NOT NULL,
  new_price DECIMAL(10, 2) NOT NULL,
  changed_by INTEGER,
  reason VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_alerts (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  shop_id INTEGER NOT NULL REFERENCES shopkeepers(id) ON DELETE CASCADE,
  alert_type VARCHAR(50) NOT NULL,
  threshold_value INTEGER,
  is_active BOOLEAN DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS barcode_scans (
  id SERIAL PRIMARY KEY,
  barcode VARCHAR(255) NOT NULL,
  product_id INTEGER,
  shop_id INTEGER,
  scanned_by INTEGER,
  scan_result VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_restoration_log (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL,
  cancelled_by VARCHAR(50) NOT NULL,
  cancellation_reason TEXT,
  items_restored INTEGER DEFAULT 0,
  total_quantity_restored INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Billing tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_payments (
  id SERIAL PRIMARY KEY,
  shopkeeper_id INTEGER NOT NULL REFERENCES shopkeepers(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  payment_method VARCHAR(50) DEFAULT 'upi',
  transaction_id VARCHAR(100),
  payment_date TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  notes TEXT,
  approved_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
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

-- ----------------------------------------------------------------------------
-- Service status
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_status (
  id SERIAL PRIMARY KEY,
  status VARCHAR(20) NOT NULL DEFAULT 'online' CHECK (status IN ('online','offline')),
  message VARCHAR(500),
  updated_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_status_history (
  id SERIAL PRIMARY KEY,
  previous_status VARCHAR(20) NOT NULL CHECK (previous_status IN ('online','offline')),
  new_status VARCHAR(20) NOT NULL CHECK (new_status IN ('online','offline')),
  message VARCHAR(500),
  changed_by INTEGER NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address VARCHAR(45),
  user_agent VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- shopping_lists — ImageKit file id (migrated from Cloudinary)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shopping_lists (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  items TEXT DEFAULT NULL,
  image_url VARCHAR(255) DEFAULT NULL,
  cloudinary_public_id VARCHAR(255) DEFAULT NULL,
  imagekit_file_id VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add imagekit_file_id if table already existed with cloudinary column
ALTER TABLE shopping_lists ADD COLUMN IF NOT EXISTS imagekit_file_id VARCHAR(255) DEFAULT NULL;

-- ----------------------------------------------------------------------------
-- Support tickets / suggestions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_tickets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  shopkeeper_id INTEGER REFERENCES shopkeepers(id) ON DELETE SET NULL,
  subject VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shop_suggestions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_name VARCHAR(255) NOT NULL,
  owner_name VARCHAR(255) DEFAULT NULL,
  phone VARCHAR(20) DEFAULT NULL,
  address VARCHAR(255) NOT NULL,
  landmark VARCHAR(255) DEFAULT NULL,
  pincode VARCHAR(20) NOT NULL,
  latitude DECIMAL(10,8) DEFAULT NULL,
  longitude DECIMAL(11,8) DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default service status
INSERT INTO service_status (status, message, is_active)
SELECT 'online', NULL, TRUE
WHERE NOT EXISTS (SELECT 1 FROM service_status WHERE is_active = TRUE);

-- Reset all sequences to start at 1 if tables are empty (idempotent)
-- These run safely on fresh DB; on existing DB they set next value to max+1 or 1 if empty
DO $$
DECLARE t TEXT;
DECLARE seq TEXT;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'
  LOOP
    -- try to find serial sequence for id column
    BEGIN
      seq := pg_get_serial_sequence(t, 'id');
      IF seq IS NOT NULL THEN
        EXECUTE format('SELECT setval(%L, COALESCE((SELECT MAX(id) FROM %I), 0) + 1, false)', seq, t);
        -- If table empty, next will be 1; ensure we restart at 1 explicitly when empty
        -- setval with false means next nextval returns that value
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- ignore tables without serial id
      CONTINUE;
    END;
  END LOOP;
END $$;

-- Explicit RESTART for known tables (fresh DB guarantees start at 1)
ALTER SEQUENCE admins_id_seq RESTART WITH 1;
ALTER SEQUENCE users_id_seq RESTART WITH 1;
ALTER SEQUENCE shopkeepers_id_seq RESTART WITH 1;
ALTER SEQUENCE global_products_id_seq RESTART WITH 1;
ALTER SEQUENCE products_id_seq RESTART WITH 1;
ALTER SEQUENCE orders_id_seq RESTART WITH 1;
ALTER SEQUENCE order_items_id_seq RESTART WITH 1;

