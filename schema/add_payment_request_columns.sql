-- Add missing columns to earnings_history table for payment request functionality

-- Add admin_notes column if it doesn't exist
ALTER TABLE earnings_history 
ADD COLUMN IF NOT EXISTS admin_notes TEXT;

-- Add updated_at column if it doesn't exist
ALTER TABLE earnings_history 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Update existing records to have updated_at = created_at
UPDATE earnings_history 
SET updated_at = created_at 
WHERE updated_at IS NULL;