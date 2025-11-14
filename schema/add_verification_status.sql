-- Migration script to add verification_status column to existing shopkeepers table
-- Run this if you already have a shopkeepers table without verification_status

ALTER TABLE shopkeepers 
ADD COLUMN verification_status ENUM('pending', 'verified', 'rejected') DEFAULT 'pending';

-- Optional: Set existing shopkeepers as verified (if you want to grandfather them in)
-- UPDATE shopkeepers SET verification_status = 'verified' WHERE verification_status IS NULL;