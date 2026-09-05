-- ============================================================================
-- Google OAuth Migration (Postgres / Neon)
-- ============================================================================
-- Adds google_id column to users and shopkeepers tables for OAuth support
-- Date: February 27, 2026

-- Add google_id to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) DEFAULT NULL;

-- Add google_id to shopkeepers table
ALTER TABLE shopkeepers
  ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) DEFAULT NULL;

-- Add unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS unique_google_id_users ON users(google_id);
CREATE UNIQUE INDEX IF NOT EXISTS unique_google_id_shopkeepers ON shopkeepers(google_id);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_shopkeepers_google_id ON shopkeepers(google_id);
