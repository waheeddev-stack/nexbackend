-- ============================================================================
-- Shopping Lists Table Migration (Postgres / Neon)
-- ============================================================================
-- Creates shopping_lists table to store customer written list text and uploaded image URLs
-- Date: July 12, 2026

CREATE TABLE IF NOT EXISTS shopping_lists (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  items TEXT DEFAULT NULL,
  image_url VARCHAR(255) DEFAULT NULL,
  cloudinary_public_id VARCHAR(255) DEFAULT NULL,
  imagekit_file_id VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_shopping_lists_user_id ON shopping_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_shopping_lists_created_at ON shopping_lists(created_at);

-- Add imagekit_file_id if table already existed with only cloudinary column
ALTER TABLE shopping_lists ADD COLUMN IF NOT EXISTS imagekit_file_id VARCHAR(255) DEFAULT NULL;
