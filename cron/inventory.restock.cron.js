/**
 * Inventory Restock Cron Job
 * 
 * This module implements the auto-restock cron job from inventorymng.
 * Runs ONCE per day at midnight (12:00 AM) to restore stock for all products with stock = 0.
 * 
 * Schedule: Daily at 12:00 AM (00:00)
 * Behavior: Restocks ALL products that have stock = 0, regardless of restockAt time
 * 
 * CRITICAL: Uses existing database connection, no schema changes.
 */

import cron from 'node-cron';
import { getInventoryDB } from '../config/inventory.db.bridge.js';

let cronJob = null;

/**
 * Start the restock cron job
 * Runs ONCE per day at midnight (12:00 AM) to restock all products with stock = 0
 */
export function startRestockCron() {
  if (cronJob) {
    console.log('⚠️ Restock cron already running');
    return;
  }
  
  // Schedule cron job to run daily at midnight (00:00)
  // Format: "0 0 * * *" = At 00:00 (midnight) every day
  cronJob = cron.schedule('0 0 * * *', async () => {
    console.log('🌙 Daily restock starting at midnight...');
    
    try {
      const { models } = await getInventoryDB();
      
      // Find ALL products with stock = 0 (ignore restockAt time)
      const products = await models.InventoryProduct.findAll({
        where: {
          stock: 0
        }
      });
      
      if (products.length === 0) {
        console.log('✅ No products need restocking');
        return;
      }
      
      console.log(`📦 Found ${products.length} product(s) with stock = 0, restocking...`);
      
      // Restock each product to baseline quantity
      let restockedCount = 0;
      for (const product of products) {
        const previousStock = product.stock;
        product.stock = product.baselineQty;
        product.restockAt = null; // Clear restockAt time
        await product.save();
        
        console.log(`✅ Restocked: ${product.name} (${previousStock} → ${product.stock})`);
        restockedCount++;
      }
      
      console.log(`🔄 Daily restock completed: ${restockedCount} product(s) restocked at midnight`);
      
    } catch (error) {
      console.error('❌ Daily restock error:', error);
    }
  });
  
  console.log('✅ Inventory restock cron started (runs daily at midnight 12:00 AM)');
  console.log('📅 Next restock will occur at 00:00 (midnight)');
}

/**
 * Stop the restock cron job
 */
export function stopRestockCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('✅ Inventory restock cron stopped');
  }
}

/**
 * Get cron job status
 */
export function getRestockCronStatus() {
  return {
    running: cronJob !== null,
    schedule: '0 0 * * *', // Daily at midnight (00:00)
    description: 'Auto-restocks ALL products with stock = 0 once per day at midnight (12:00 AM)'
  };
}
