-- ============================================================================
-- Shop Suggestions Table Migration (Postgres / Neon)
-- ============================================================================
-- Creates shop_suggestions table to store customer submissions of new shop recommendations
-- Date: July 13, 2026

CREATE TABLE IF NOT EXISTS shop_suggestions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  shop_name VARCHAR(100) NOT NULL,
  owner_name VARCHAR(100) DEFAULT NULL,
  phone VARCHAR(20) NOT NULL,
  address VARCHAR(255) NOT NULL,
  landmark VARCHAR(150) DEFAULT NULL,
  pincode VARCHAR(10) NOT NULL,
  latitude DECIMAL(10,8) DEFAULT NULL,
  longitude DECIMAL(11,8) DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  status VARCHAR(10) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_shop_suggestions_user_id ON shop_suggestions(user_id);
CREATE INDEX IF NOT EXISTS idx_shop_suggestions_status ON shop_suggestions(status);
