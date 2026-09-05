-- ============================================================================
-- Google OAuth Migration (Postgres / Neon)
-- ============================================================================
-- Adds google_id column to users and shopkeepers tables for OAuth support
-- Date: March 8, 2026

-- Step 1: Add google_id column to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) DEFAULT NULL;

-- Step 2: Add google_id column to shopkeepers table
ALTER TABLE shopkeepers
  ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) DEFAULT NULL;

-- Step 3: Add unique constraints (unique index = unique key in PG)
CREATE UNIQUE INDEX IF NOT EXISTS unique_google_id_users ON users(google_id);
CREATE UNIQUE INDEX IF NOT EXISTS unique_google_id_shopkeepers ON shopkeepers(google_id);

-- Step 4: Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_shopkeepers_google_id ON shopkeepers(google_id);

-- ============================================================================
-- Verification Queries (Postgres)
-- ============================================================================

-- Check if google_id column exists in users table
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='users' AND column_name='google_id';

-- Check if google_id column exists in shopkeepers table
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='shopkeepers' AND column_name='google_id';

-- Check indexes
SELECT indexname FROM pg_indexes WHERE tablename='users' AND indexname LIKE '%google%';
SELECT indexname FROM pg_indexes WHERE tablename='shopkeepers' AND indexname LIKE '%google%';
