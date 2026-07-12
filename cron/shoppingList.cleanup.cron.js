import cron from "node-cron";
import pool from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

let cronJob = null;

/**
 * Cleanup shopping lists and Cloudinary images older than 15 days
 */
export async function cleanupExpiredShoppingLists() {
  console.log("🔄 Starting expired shopping lists cleanup (15-day retention policy)...");
  try {
    // 1. Fetch all expired shopping lists (older than 15 days) that have images
    const [expiredLists] = await pool.query(`
      SELECT id, cloudinary_public_id 
      FROM shopping_lists 
      WHERE created_at < DATE_SUB(NOW(), INTERVAL 15 DAY)
    `);

    console.log(`🔍 Found ${expiredLists.length} expired shopping list(s) to cleanup`);

    // 2. Delete Cloudinary images if they exist
    for (const list of expiredLists) {
      if (list.cloudinary_public_id) {
        try {
          console.log(`🗑️ Deleting Cloudinary image ${list.cloudinary_public_id} for expired list ${list.id}...`);
          await cloudinary.uploader.destroy(list.cloudinary_public_id);
        } catch (cloudinaryError) {
          console.error(`❌ Failed to delete Cloudinary image for list ${list.id}:`, cloudinaryError);
        }
      }
    }

    // 3. Delete records from the database
    const [result] = await pool.query(`
      DELETE FROM shopping_lists 
      WHERE created_at < DATE_SUB(NOW(), INTERVAL 15 DAY)
    `);

    console.log(`✅ Deleted ${result.affectedRows} expired shopping list record(s) from database`);
  } catch (error) {
    console.error("❌ Expired shopping lists cleanup error:", error);
  }
}

/**
 * Start the shopping list cleanup cron job
 * Runs once a day at midnight (12:00 AM)
 */
export function startShoppingListCleanupCron() {
  if (cronJob) {
    console.log("⚠️ Shopping list cleanup cron already running");
    return;
  }

  // Schedule cron job to run once a day at midnight (00:00)
  cronJob = cron.schedule("0 0 * * *", async () => {
    await cleanupExpiredShoppingLists();
  });

  console.log("✅ Shopping list cleanup cron started (schedule: 0 0 * * *)");
  
  // Run an initial cleanup run on startup to catch anything that expired while the server was down
  cleanupExpiredShoppingLists();
}

/**
 * Stop the shopping list cleanup cron job
 */
export function stopShoppingListCleanupCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log("✅ Shopping list cleanup cron stopped");
  }
}

/**
 * Get the status of the cleanup cron job
 */
export function getShoppingListCleanupCronStatus() {
  return {
    running: cronJob !== null,
    schedule: "0 0 * * *",
    description: "Deletes expired shopping lists and their Cloudinary images after 15 days.",
  };
}
