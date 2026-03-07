/**
 * Check Restock Ready Status
 * 
 * Shows which products are ready for auto-restock (have baselineQty set by shopkeeper)
 */

import dotenv from 'dotenv';
import pool from '../config/db.js';

dotenv.config();

async function checkRestockReady() {
  try {
    console.log('\n🔍 Checking Restock Ready Status...\n');
    
    // Check products statistics
    console.log('📊 Products Statistics:');
    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END) as zero_stock,
        SUM(CASE WHEN baselineQty IS NOT NULL AND baselineQty > 0 THEN 1 ELSE 0 END) as has_baseline,
        SUM(CASE WHEN baselineQty IS NULL OR baselineQty = 0 THEN 1 ELSE 0 END) as no_baseline,
        SUM(CASE WHEN stock = 0 AND baselineQty IS NOT NULL AND baselineQty > 0 THEN 1 ELSE 0 END) as ready_for_restock
      FROM products
    `);
    
    console.log(`   Total products: ${stats[0].total}`);
    console.log(`   Products with stock = 0: ${stats[0].zero_stock}`);
    console.log(`   Products with baseline set (>0): ${stats[0].has_baseline}`);
    console.log(`   Products without baseline (NULL or 0): ${stats[0].no_baseline}`);
    console.log(`   Products ready for auto-restock: ${stats[0].ready_for_restock}`);
    
    // Show sample products ready for restock
    if (stats[0].ready_for_restock > 0) {
      console.log('\n📦 Sample products ready for auto-restock:');
      const [samples] = await pool.query(`
        SELECT id, name, shop_id, stock, baselineQty
        FROM products
        WHERE stock = 0 AND baselineQty IS NOT NULL AND baselineQty > 0
        LIMIT 10
      `);
      
      samples.forEach(p => {
        console.log(`   - ID: ${p.id}, Name: ${p.name}, Shop: ${p.shop_id}, Stock: ${p.stock}, BaselineQty: ${p.baselineQty}`);
      });
    } else {
      console.log('\n✅ No products currently need restocking');
    }
    
    // Show sample products with baseline set
    console.log('\n📋 Sample products with baseline quantity set:');
    const [withBaseline] = await pool.query(`
      SELECT id, name, shop_id, stock, baselineQty
      FROM products
      WHERE baselineQty IS NOT NULL AND baselineQty > 0
      LIMIT 5
    `);
    
    if (withBaseline.length > 0) {
      withBaseline.forEach(p => {
        console.log(`   - ID: ${p.id}, Name: ${p.name}, Shop: ${p.shop_id}, Stock: ${p.stock}, BaselineQty: ${p.baselineQty}`);
      });
    } else {
      console.log('   No products have baseline quantity set yet');
      console.log('   Shopkeepers need to set baseline quantities in their app');
    }
    
    console.log('\n💡 How it works:');
    console.log('   1. Shopkeepers set baselineQty for products they want auto-restocked');
    console.log('   2. When stock hits 0, cron job restocks to baselineQty');
    console.log('   3. Products with baselineQty = 0 or NULL are manual-only (no auto-restock)');
    
    console.log('\n✅ Check complete!\n');
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkRestockReady();
