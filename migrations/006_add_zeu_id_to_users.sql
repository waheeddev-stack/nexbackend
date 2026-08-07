-- Migration 006: Add zeu_id to users table
-- This adds a human-readable Zeu ID for customers (format: ZEU-{id})

-- Add zeu_id column to users table
ALTER TABLE users 
ADD COLUMN zeu_id VARCHAR(20) NULL AFTER id;

-- Create unique index for zeu_id
CREATE UNIQUE INDEX idx_users_zeu_id ON users(zeu_id);

-- Populate zeu_id for existing users (format: ZEU-{id})
UPDATE users SET zeu_id = CONCAT('ZEU-', LPAD(id, 6, '0')) WHERE zeu_id IS NULL;

-- Make zeu_id NOT NULL after population
ALTER TABLE users MODIFY COLUMN zeu_id VARCHAR(20) NOT NULL;