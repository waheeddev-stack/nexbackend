-- Add verification_status column to existing shopkeepers table
-- This is a migration script to add the verification system to existing shopkeepers

ALTER TABLE shopkeepers 
ADD COLUMN verification_status ENUM('pending', 'verified', 'rejected') DEFAULT 'pending';

-- Set existing shopkeepers to verified so they are not affected
UPDATE shopkeepers 
SET verification_status = 'verified' 
WHERE verification_status IS NULL;