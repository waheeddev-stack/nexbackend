/**
 * Inventory Restock Cron Job
 *
 * This module implements the auto-restock functionality.
 * Runs ONCE per day at midnight (12:00 AM) to restore stock ONLY for out-of-stock products.
 *
 * Schedule: Daily at 12:00 AM (midnight)
 * Behavior: Sets stock = baselineQty ONLY for products where stock = 0
 *
 * CRITICAL: Only restocks when stock hits zero (completely out of stock).
 */

import cron from "node-cron";
import pool from "../config/db.js";

let cronJob = null;

/**
 * Start the restock cron job
 * Runs ONCE per day at midnight (12:00 AM) to restock out-of-stock products
 *
 * For testing: Change schedule to '* * * * *' to run every minute
 * For production: Use '0 0 * * *' to run at midnight
 */
export function startRestockCron() {
  if (cronJob) {
    console.log("⚠️ Restock cron already running");
    return;
  }

  // Schedule cron job
  // Testing: "* * * * *" = Every minute
  // Production: "0 0 * * *" = At 00:00 (midnight) every day
  const schedule = process.env.RESTOCK_CRON_SCHEDULE || "0 0 * * *";

  cronJob = cron.schedule(schedule, async () => {
    const isTestMode = schedule === "* * * * *";
    console.log(
      `🔄 ${isTestMode ? "TEST MODE" : "PRODUCTION"} restock starting...`
    );

    try {
      // Update ALL products where:
      // 1. stock = 0 (completely out of stock)
      // 2. baselineQty > 0 (has a valid baseline quantity set by shopkeeper)
      // Note: Products with baselineQty = 0 or NULL won't be restocked (shopkeeper hasn't set baseline yet)
      const [result] = await pool.query(`
        UPDATE products
        SET stock = baselineQty,
            available_stock = 'IN STOCK'
        WHERE stock = 0
        AND baselineQty > 0
        AND available_stock <> 'INVISIBLE'
      `);

      const restockedCount = result.affectedRows;

      if (restockedCount === 0) {
        console.log(
          "✅ No products need restocking (no products at stock = 0 with baselineQty > 0)"
        );
        return;
      }

      console.log(
        `📦 Restocked ${restockedCount} out-of-stock product(s) to their baseline quantities`
      );

      // Get sample of restocked products for logging
      const [samples] = await pool.query(`
        SELECT id, name, shop_id, stock, baselineQty
        FROM products
        WHERE stock > 0 AND baselineQty > 0
        ORDER BY RAND()
        LIMIT 5
      `);

      if (samples.length > 0) {
        console.log("📋 Sample restocked products:");
        samples.forEach((p) => {
          console.log(
            `   - ${p.name} (ID: ${p.id}, Shop: ${p.shop_id}): 0 → ${p.baselineQty}`
          );
        });
      }

      console.log(
        `🔄 Restock completed: ${restockedCount} product(s) restocked from 0 to baselineQty`
      );
    } catch (error) {
      console.error("❌ Restock error:", error);
    }
  });

  console.log(`✅ Inventory restock cron started (schedule: ${schedule})`);
  if (schedule === "* * * * *") {
    console.log("⚠️  TEST MODE: Running every minute");
  } else {
    console.log("📅 PRODUCTION MODE: Runs daily at midnight (00:00)");
  }
  console.log(
    "🔄 ONLY products with stock = 0 AND baselineQty > 0 will be restocked"
  );
}

/**
 * Stop the restock cron job
 */
export function stopRestockCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log("✅ Inventory restock cron stopped");
  }
}

/**
 * Get cron job status
 */
export function getRestockCronStatus() {
  return {
    running: cronJob !== null,
    schedule: "0 0 * * *", // Daily at midnight (00:00)
    description:
      "Auto-restocks products where stock = 0 (out of stock) once per day at midnight (12:00 AM)",
  };
}
