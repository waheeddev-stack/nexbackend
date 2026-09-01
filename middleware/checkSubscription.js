import { calculateSubscriptionStatus } from "../utils/subscription.js";
import dotenv from "dotenv";

dotenv.config();

/**
 * Middleware to check shopkeeper subscription status
 * Blocks access if payment overdue beyond grace period
 *
 * Can be enabled/disabled via ENFORCE_SUBSCRIPTIONS environment variable
 */
export const checkSubscriptionStatus = async (req, res, next) => {
  try {
    // Check if subscription enforcement is enabled
    const enforceSubscriptions = process.env.ENFORCE_SUBSCRIPTIONS === "true";

    if (!enforceSubscriptions) {
      // Subscription enforcement is disabled - platform is free
      console.log("ℹ️ Subscription enforcement disabled - allowing access");
      return next();
    }

    const shopkeeperId = req.user.id;

    // Calculate current subscription status
    const status = await calculateSubscriptionStatus(shopkeeperId);

    console.log(`🔍 Subscription check for shopkeeper ${shopkeeperId}:`, {
      status: status.status,
      isActive: status.isActive,
      needsPayment: status.needsPayment,
    });

    // Block if account is suspended (grace period ended)
    if (status.isAccountSuspended) {
      console.warn(`🚫 Blocking suspended shopkeeper ${shopkeeperId}`);
      return res.status(403).json({
        success: false,
        message:
          "Your account has been suspended due to payment overdue. Please contact support or make a payment to reactivate.",
        subscription_status: "suspended",
        days_overdue: status.daysOverdue,
        next_payment_due: status.nextPaymentDue,
        grace_period_end: status.gracePeriodEnd,
      });
    }

    // Warn if in grace period (but still allow access)
    if (status.isInGracePeriod) {
      console.warn(
        `⚠️ Shopkeeper ${shopkeeperId} in grace period: ${status.graceDaysRemaining} days left`
      );
      // Attach warning to request for potential use in response
      req.subscriptionWarning = {
        message: `Payment overdue - ${status.graceDaysRemaining} grace days remaining`,
        days_remaining: status.graceDaysRemaining,
        next_payment_due: status.nextPaymentDue,
      };
    }

    // Attach full status to request for use in routes
    req.subscriptionStatus = status;

    // Allow access if payment current
    next();
  } catch (err) {
    console.error("❌ Subscription check error:", err);
    // Fail open - don't block access on error for better UX
    // But log the error for monitoring
    console.error("Error details:", err.message);
    next();
  }
};

/**
 * Middleware variant that only warns but doesn't block
 * Useful for gradual rollout or monitoring
 */
export const warnSubscriptionStatus = async (req, res, next) => {
  try {
    const shopkeeperId = req.user.id;
    const status = await calculateSubscriptionStatus(shopkeeperId);

    // Just attach status, never block
    req.subscriptionStatus = status;

    if (status.isAccountSuspended) {
      console.warn(
        `⚠️ WARNING: Shopkeeper ${shopkeeperId} should be suspended but access allowed (warn-only mode)`
      );
    }

    next();
  } catch (err) {
    console.error("Subscription warning error:", err);
    next();
  }
};

export default checkSubscriptionStatus;
