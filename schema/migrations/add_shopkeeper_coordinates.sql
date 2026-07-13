-- Migration to add latitude and longitude to the shopkeepers table
-- This enables providing user directions to the shops

ALTER TABLE shopkeepers ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8);
ALTER TABLE shopkeepers ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8);

-- Add an index for faster spatial/location-based queries
CREATE INDEX IF NOT EXISTS idx_shopkeeper_location ON shopkeepers (latitude, longitude);
