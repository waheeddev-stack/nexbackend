-- Add 'grace_period' to subscription_status ENUM
-- This migration adds the grace_period status to the subscription flow

-- Step 1: Modify the ENUM to include 'grace_period'
ALTER TABLE shopkeepers 
MODIFY COLUMN subscription_status ENUM('trial', 'active', 'grace_period', 'overdue', 'suspended') DEFAULT 'active';

-- Step 2: Update any existing 'overdue' statuses to 'grace_period' if they're within grace period
-- This ensures existing overdue accounts get the grace period benefit
UPDATE shopkeepers 
SET subscription_status = 'grace_period'
WHERE subscription_status = 'overdue' 
  AND next_payment_due IS NOT NULL 
  AND grace_period_end IS NOT NULL
  AND NOW() > next_payment_due 
  AND NOW() <= grace_period_end;

-- Step 3: Update any accounts past grace period to 'suspended'
UPDATE shopkeepers 
SET subscription_status = 'suspended'
WHERE subscription_status IN ('overdue', 'grace_period')
  AND grace_period_end IS NOT NULL
  AND NOW() > grace_period_end;

-- Verification query (run this to check the changes)
-- SELECT subscription_status, COUNT(*) as count 
-- FROM shopkeepers 
-- GROUP BY subscription_status;
