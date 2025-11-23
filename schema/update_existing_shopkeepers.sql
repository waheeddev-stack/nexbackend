-- Update existing shopkeepers to verified status
-- This ensures existing shopkeepers are not affected by the new verification system
UPDATE shopkeepers 
SET verification_status = 'verified' 
WHERE verification_status IS NULL OR verification_status = 'pending';

-- Add comment for tracking
-- This migration was run to grandfather existing shopkeepers