import cron from "node-cron";
import pool from "../config/db.js";
import imagekit from "../config/imagekit.js";
// backward compat: cloudinary shim now points to imagekit
import cloudinary from "../config/cloudinary.js";

let cronJob = null;

/**
 * Cleanup shopping lists and ImageKit images older than 15 days
 * (migrated from Cloudinary; destroys via ImageKit shim)
 */
export async function cleanupExpiredShoppingLists() {
  console.log(
    "🔄 Starting expired shopping lists cleanup (15-day retention policy)..."
  );
  try {
    // 1. Fetch all expired shopping lists (older than 15 days) that have images
    // Supports both legacy cloudinary_public_id and new imagekit_file_id
    const [expiredLists] = await pool.query(`
      SELECT id, cloudinary_public_id, imagekit_file_id
      FROM shopping_lists 
      WHERE created_at < NOW() - INTERVAL '15 days'
    `);

    console.log(
      `🔍 Found ${expiredLists.length} expired shopping list(s) to cleanup`
    );

    const idsToDelete = [];
    const failedImageDeletes = [];

    // 2. Delete ImageKit images (when present) and track which rows can be removed
    for (const list of expiredLists) {
      const fileId = list.imagekit_file_id || list.cloudinary_public_id;
      if (!fileId) {
        idsToDelete.push(list.id);
        continue;
      }

      try {
        console.log(
          `🗑️ Deleting ImageKit file ${fileId} for expired list ${list.id}...`
        );
        // shim supports both destroy(fileId) and deleteFile
        if (imagekit.isConfigured()) {
          await imagekit.uploader.destroy(fileId);
        } else {
          await cloudinary.uploader.destroy(fileId);
        }
        idsToDelete.push(list.id);
      } catch (imagekitError) {
        failedImageDeletes.push(list.id);
        console.error(
          `❌ Failed to delete ImageKit file for list ${list.id}:`,
          imagekitError
        );
      }
    }

    // 3. Delete records from the database (skip rows whose image deletion failed so we can retry later)
    if (idsToDelete.length > 0) {
      const [result] = await pool.query(
        "DELETE FROM shopping_lists WHERE id IN (?)",
        [idsToDelete]
      );
      console.log(
        `✅ Deleted ${result.affectedRows} expired shopping list record(s) from database`
      );
    }

    if (failedImageDeletes.length > 0) {
      console.warn(
        `⚠️ Skipped deleting ${failedImageDeletes.length} record(s) due to ImageKit deletion failures`
      );
    }
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
    description:
      "Deletes expired shopping lists and their ImageKit images after 15 days.",
  };
}
