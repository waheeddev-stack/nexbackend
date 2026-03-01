import pool from '../config/db.js';

// Subscription constants
const BILLING_CYCLE_DAYS = 15;
const GRACE_PERIOD_DAYS = 2;

/**
 * Calculate subscription status for a shopkeeper
 */
async function calculateSubscriptionStatus(shopkeeperId) {
  const [shopkeepers] = await pool.query(
    'SELECT * FROM shopkeepers WHERE id = ?',
    [shopkeeperId]
  );

  if (shopkeepers.length === 0) {
    throw new Error('Shopkeeper not found');
  }

  const shopkeeper = shopkeepers[0];
  const now = new Date();

  // No trial period - start billing from day 1
  const lastPaymentDate = shopkeeper.last_payment_date 
    ? new Date(shopkeeper.last_payment_date)
    : new Date(shopkeeper.created_at);

  const nextPaymentDue = new Date(lastPaymentDate);
  nextPaymentDue.setDate(nextPaymentDue.getDate() + BILLING_CYCLE_DAYS);

  const gracePeriodEnd = new Date(nextPaymentDue);
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + GRACE_PERIOD_DAYS);

  const isPaymentOverdue = now > nextPaymentDue;
  const isInGracePeriod = isPaymentOverdue && now <= gracePeriodEnd;
  const isAccountSuspended = now > gracePeriodEnd;

  const daysOverdue = isPaymentOverdue
    ? Math.ceil((now - nextPaymentDue) / (1000 * 60 * 60 * 24))
    : 0;

  const graceDaysRemaining = isInGracePeriod
    ? Math.ceil((gracePeriodEnd - now) / (1000 * 60 * 60 * 24))
    : 0;

  // Determine status
  let status = 'active';
  let isActive = true;
  let message = 'Subscription active';
  let needsPayment = false;

  if (isAccountSuspended) {
    status = 'suspended';
    isActive = false;
    message = 'Account suspended - Payment overdue';
    needsPayment = true;
  } else if (isInGracePeriod) {
    status = 'overdue';
    isActive = true;
    message = `Payment overdue - ${graceDaysRemaining} grace days remaining`;
    needsPayment = true;
  } else if (isPaymentOverdue) {
    status = 'overdue';
    isActive = false;
    message = 'Payment required';
    needsPayment = true;
  }

  return {
    status,
    isActive,
    lastPaymentDate,
    nextPaymentDue,
    gracePeriodEnd,
    daysOverdue,
    graceDaysRemaining,
    message,
    needsPayment,
    isInGracePeriod,
    isAccountSuspended,
  };
}

/**
 * Update shopkeeper subscription status in database
 */
async function updateSubscriptionStatus(shopkeeperId) {
  const statusInfo = await calculateSubscriptionStatus(shopkeeperId);

  await pool.query(
    `UPDATE shopkeepers 
     SET subscription_status = ?,
         next_payment_due = ?,
         grace_period_end = ?
     WHERE id = ?`,
    [
      statusInfo.status,
      statusInfo.nextPaymentDue || null,
      statusInfo.gracePeriodEnd || null,
      shopkeeperId,
    ]
  );

  return statusInfo;
}

/**
 * Process payment and update subscription
 */
async function processPaymentApproval(shopkeeperId) {
  const now = new Date();
  
  // Update last payment date
  await pool.query(
    `UPDATE shopkeepers 
     SET last_payment_date = ?,
         subscription_status = 'active'
     WHERE id = ?`,
    [now, shopkeeperId]
  );

  // Calculate new billing cycle
  const nextPaymentDue = new Date(now);
  nextPaymentDue.setDate(nextPaymentDue.getDate() + BILLING_CYCLE_DAYS);

  const gracePeriodEnd = new Date(nextPaymentDue);
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + GRACE_PERIOD_DAYS);

  await pool.query(
    `UPDATE shopkeepers 
     SET next_payment_due = ?,
         grace_period_end = ?
     WHERE id = ?`,
    [nextPaymentDue, gracePeriodEnd, shopkeeperId]
  );

  return {
    success: true,
    nextPaymentDue,
    gracePeriodEnd,
  };
}

/**
 * Check if shopkeeper can access the app
 */
async function canAccessApp(shopkeeperId) {
  const statusInfo = await calculateSubscriptionStatus(shopkeeperId);
  return statusInfo.isActive;
}

export {
  calculateSubscriptionStatus,
  updateSubscriptionStatus,
  processPaymentApproval,
  canAccessApp,
  BILLING_CYCLE_DAYS,
  GRACE_PERIOD_DAYS,
};
