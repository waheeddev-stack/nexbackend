/**
 * Inventory Restock Cron Job
 * 
 * This module implements the auto-restock cron job from inventorymng.
 * It runs periodically to restore stock for products that have reached their restock time.
 * 
 * CRITICAL: Uses existing database connection, no schema changes.
 */

import cron from 'node-cron';
import { getInventoryDB } from '../config/inventory.db.bridge.js';

let cronJob = null;

/**
 * Start the restock cron job (from inventorymng/cron/restockCron.js)
 * Runs every minute to check for products that need restocking
 */
export function startRestockCron() {
  if (cronJob) {
    console.log('⚠️ Restock cron already running');
    return;
  }
  
  // Schedule cron job to run every minute
  cronJob = cron.schedule('* * * * *', async () => {
    try {
      const { models, sequelize } = await getInventoryDB();
      const { Op } = sequelize.Sequelize;
      const now = new Date();
      
      // Find products that need restocking
      const products = await models.InventoryProduct.findAll({
        where: {
          stock: 0,
          restockAt: { 
            [Op.lte]: now,
            [Op.ne]: null
          }
        }
      });
      
      if (products.length === 0) {
        return; // No products to restock
      }
      
      // Restock each product
      for (const product of products) {
        const previousStock = product.stock;
        product.stock = product.baselineQty;
        product.restockAt = null;
        await product.save();
        
        console.log(`✅ Auto-restocked: ${product.name} (${previousStock} → ${product.stock})`);
      }
      
      console.log(`🔄 Restock cron completed: ${products.length} product(s) restocked`);
      
    } catch (error) {
      console.error('❌ Restock cron error:', error);
    }
  });
  
  console.log('✅ Inventory restock cron started (runs every minute)');
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
    schedule: '* * * * *', // Every minute
    description: 'Auto-restocks products when restockAt time is reached'
  };
}
