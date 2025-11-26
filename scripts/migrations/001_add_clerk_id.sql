-- Migration: add clerk_id to users table (run manually)
ALTER TABLE users
ADD COLUMN clerk_id VARCHAR(255) UNIQUE NULL;

-- Optionally add an index for faster lookups by clerk_id
CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON users (clerk_id);
