/**
 * Subscription Status Cron Job
 *
 * This module implements automatic subscription status updates based on payment due dates and grace periods.
 *
 * Status Flow:
 * 1. active → grace_period (when payment due date passes)
 * 2. grace_period → suspended (when grace period ends)
 *
 * Billing Cycle:
 * - 15 days billing period
 * - 2 days grace period after payment due
 * - Total: 17 days from last payment to suspension
 */

import cron from "node-cron";
import pool from "../config/db.js";

let cronJob = null;

/**
 * Update subscription statuses based on payment dates
 */
async function updateSubscriptionStatuses() {
  try {
    const now = new Date();

    // 1. Move active accounts to grace_period if payment is overdue
    const [movedToGrace] = await pool.query(
      `
      UPDATE shopkeepers 
      SET subscription_status = 'grace_period'
      WHERE subscription_status = 'active'
        AND next_payment_due IS NOT NULL
        AND next_payment_due < ?
        AND grace_period_end IS NOT NULL
        AND grace_period_end >= ?
        AND is_verified = 1
        AND is_deleted = 0
    `,
      [now, now]
    );

    if (movedToGrace.affectedRows > 0) {
      console.log(
        `⚠️ Moved ${movedToGrace.affectedRows} shopkeeper(s) to grace_period status`
      );
    }

    // 2. Move grace_period accounts to suspended if grace period has ended
    const [movedToSuspended] = await pool.query(
      `
      UPDATE shopkeepers 
      SET subscription_status = 'suspended'
      WHERE subscription_status IN ('grace_period', 'overdue')
        AND grace_period_end IS NOT NULL
        AND grace_period_end < ?
        AND is_verified = 1
        AND is_deleted = 0
    `,
      [now]
    );

    if (movedToSuspended.affectedRows > 0) {
      console.log(
        `🚫 Suspended ${movedToSuspended.affectedRows} shopkeeper(s) - grace period expired`
      );
    }

    // 3. Log current status distribution
    const [statusCounts] = await pool.query(`
      SELECT 
        subscription_status,
        COUNT(*) as count
      FROM shopkeepers
      WHERE is_verified = 1 AND is_deleted = 0
      GROUP BY subscription_status
    `);

    if (movedToGrace.affectedRows > 0 || movedToSuspended.affectedRows > 0) {
      console.log("📊 Current subscription status distribution:");
      statusCounts.forEach((row) => {
        console.log(`   ${row.subscription_status || "null"}: ${row.count}`);
      });
    }
  } catch (error) {
    console.error("❌ Subscription status update error:", error);
  }
}

/**
 * Start the subscription status cron job
 * Runs every hour to check and update subscription statuses
 */
export function startSubscriptionStatusCron() {
  if (cronJob) {
    console.log("⚠️ Subscription status cron already running");
    return;
  }

  // Schedule cron job to run every hour at minute 0
  // Format: "0 * * * *" = At minute 0 of every hour
  cronJob = cron.schedule("0 * * * *", async () => {
    console.log("🔄 Running subscription status check...");
    await updateSubscriptionStatuses();
  });

  // Run immediately on startup
  console.log("✅ Subscription status cron started (runs every hour)");
  console.log("🔄 Running initial subscription status check...");
  updateSubscriptionStatuses();
}

/**
 * Stop the subscription status cron job
 */
export function stopSubscriptionStatusCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log("✅ Subscription status cron stopped");
  }
}

/**
 * Get cron job status
 */
export function getSubscriptionStatusCronStatus() {
  return {
    running: cronJob !== null,
    schedule: "0 * * * *", // Every hour
    description:
      "Automatically updates subscription statuses: active → grace_period → suspended",
  };
}

/**
 * Manual trigger for testing
 */
export async function triggerSubscriptionStatusUpdate() {
  console.log("🔄 Manual subscription status update triggered...");
  await updateSubscriptionStatuses();
}
