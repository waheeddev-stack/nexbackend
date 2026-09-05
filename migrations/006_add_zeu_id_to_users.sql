-- Migration 006: Add zeu_id to users table (Postgres / Neon)
-- This adds a human-readable Zeu ID for customers (format: ZEU-{id})

-- Add zeu_id column to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS zeu_id VARCHAR(20) NULL;

-- Create unique index for zeu_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_zeu_id ON users(zeu_id);

-- Populate zeu_id for existing users (format: ZEU-{id}; LPAD -> lpad)
UPDATE users SET zeu_id = 'ZEU-' || lpad(id::TEXT, 6, '0') WHERE zeu_id IS NULL;

-- Make zeu_id NOT NULL after population
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='users' AND column_name='zeu_id' AND is_nullable='YES') THEN
    ALTER TABLE users ALTER COLUMN zeu_id SET NOT NULL;
  END IF;
END $$;
