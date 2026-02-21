-- Add is_online column to shopkeepers table
-- Default is 1 (online) so existing shops remain visible
ALTER TABLE shopkeepers ADD COLUMN is_online TINYINT(1) DEFAULT 1;

-- Create index for faster queries
CREATE INDEX idx_shopkeepers_online ON shopkeepers(is_online);
