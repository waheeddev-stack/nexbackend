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

import cron from 'node-cron';
import pool from '../config/db.js';

let cronJob = null;

/**
 * Start the restock cron job
 * Runs ONCE per day at midnight (12:00 AM) to restock out-of-stock products
 */
export function startRestockCron() {
  if (cronJob) {
    console.log('⚠️ Restock cron already running');
    return;
  }
  
  // Schedule cron job to run daily at midnight (00:00)
  // Format: "0 0 * * *" = At 00:00 (midnight) every day
  cronJob = cron.schedule('0 0 * * *', async () => {
    console.log('🌙 Daily restock starting at midnight (12:00 AM)...');
    
    try {
      // Update ONLY products where stock = 0 (completely out of stock)
      // Products with stock > 0 are NOT restocked (shopkeeper manages those)
      const [result] = await pool.query(`
        UPDATE products 
        SET stock = baselineQty 
        WHERE baselineQty > 0 
        AND stock = 0
      `);
      
      const restockedCount = result.affectedRows;
      
      if (restockedCount === 0) {
        console.log('✅ No products need restocking (no products at stock = 0)');
        return;
      }
      
      console.log(`📦 Restocked ${restockedCount} out-of-stock product(s) to their baseline quantities`);
      
      // Get sample of restocked products for logging
      const [samples] = await pool.query(`
        SELECT id, name, shop_id, stock, baselineQty
        FROM products
        WHERE baselineQty > 0 AND stock > 0
        ORDER BY RAND()
        LIMIT 5
      `);
      
      if (samples.length > 0) {
        console.log('📋 Sample restocked products:');
        samples.forEach(p => {
          console.log(`   - ${p.name} (ID: ${p.id}, Shop: ${p.shop_id}): 0 → ${p.baselineQty}`);
        });
      }
      
      console.log(`🔄 Daily restock completed at midnight: ${restockedCount} product(s) restocked from 0 to baselineQty`);
      
    } catch (error) {
      console.error('❌ Daily restock error:', error);
    }
  });
  
  console.log('✅ Inventory restock cron started (runs daily at midnight 12:00 AM)');
  console.log('📅 Next restock will occur at 00:00 (midnight)');
  console.log('🔄 ONLY products with stock = 0 will be restocked to baselineQty');
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
    description: 'Auto-restocks products where stock = 0 (out of stock) once per day at midnight (12:00 AM)'
  };
}
