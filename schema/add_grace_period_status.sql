-- Add 'grace_period' to subscription_status check (Postgres / Neon)
-- This migration adds the grace_period status to the subscription flow

-- Step 1: Alter the CHECK constraint to include 'grace_period' (replaces MySQL ENUM MODIFY)
ALTER TABLE shopkeepers
  DROP CONSTRAINT IF EXISTS shopkeepers_subscription_status_check;
ALTER TABLE shopkeepers
  ADD CONSTRAINT shopkeepers_subscription_status_check
  CHECK (subscription_status IN ('trial','active','grace_period','overdue','suspended'));

-- Step 2: Update any existing 'overdue' statuses to 'grace_period' if they're within grace period
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
