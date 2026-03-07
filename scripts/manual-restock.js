/**
 * Manual Restock Trigger
 * 
 * Manually trigger the restock process without waiting for the cron job.
 * Useful for testing and immediate restocking needs.
 */

import dotenv from 'dotenv';
import pool from '../config/db.js';

dotenv.config();

async function manualRestock() {
  try {
    console.log('\n🔄 Manual Restock Starting...\n');
    
    // Check what will be restocked
    console.log('📊 Step 1: Checking products that need restocking...');
    const [needsRestock] = await pool.query(`
      SELECT COUNT(*) as count
      FROM products
      WHERE baselineQty > 0 AND stock = 0
    `);
    
    if (needsRestock[0].count === 0) {
      console.log('✅ No products need restocking (no products at stock = 0 with baselineQty > 0)');
      await pool.end();
      return;
    }
    
    console.log(`   Found ${needsRestock[0].count} product(s) that need restocking`);
    
    // Show sample before restocking
    console.log('\n📦 Sample products before restock:');
    const [beforeSamples] = await pool.query(`
      SELECT id, name, shop_id, stock, baselineQty
      FROM products
      WHERE baselineQty > 0 AND stock = 0
      LIMIT 10
    `);
    
    beforeSamples.forEach(p => {
      console.log(`   - ID: ${p.id}, Name: ${p.name}, Shop: ${p.shop_id}, Stock: ${p.stock}, BaselineQty: ${p.baselineQty}`);
    });
    
    // Perform restock
    console.log('\n🔄 Step 2: Restocking products...');
    const [result] = await pool.query(`
      UPDATE products 
      SET stock = baselineQty 
      WHERE baselineQty > 0 
      AND stock = 0
    `);
    
    const restockedCount = result.affectedRows;
    console.log(`   ✅ Restocked ${restockedCount} product(s)`);
    
    // Show sample after restocking
    console.log('\n📦 Sample products after restock:');
    const [afterSamples] = await pool.query(`
      SELECT id, name, shop_id, stock, baselineQty
      FROM products
      WHERE id IN (${beforeSamples.map(p => p.id).join(',')})
    `);
    
    afterSamples.forEach(p => {
      console.log(`   - ID: ${p.id}, Name: ${p.name}, Shop: ${p.shop_id}, Stock: ${p.stock} (was 0), BaselineQty: ${p.baselineQty}`);
    });
    
    // Final statistics
    console.log('\n📊 Step 3: Final statistics...');
    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END) as zero_stock,
        SUM(CASE WHEN stock = 0 AND baselineQty > 0 THEN 1 ELSE 0 END) as still_needs_restock
      FROM products
    `);
    
    console.log(`   Total products: ${stats[0].total}`);
    console.log(`   Products with stock = 0: ${stats[0].zero_stock}`);
    console.log(`   Products still needing restock: ${stats[0].still_needs_restock}`);
    
    console.log('\n✅ Manual restock completed successfully!');
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

manualRestock();
