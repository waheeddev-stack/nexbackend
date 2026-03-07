/**
 * Fix Baseline Quantity for Products
 * 
 * This script sets baselineQty for products that have NULL or 0 values.
 * Products with stock=0 will get a default baselineQty so they can be restocked.
 */

import dotenv from 'dotenv';
import pool from '../config/db.js';

dotenv.config();

async function fixBaselineQty() {
  try {
    console.log('\n🔧 Fixing Baseline Quantities...\n');
    
    // Check current state
    console.log('📊 Step 1: Checking current state...');
    const [before] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN baselineQty IS NULL OR baselineQty = 0 THEN 1 ELSE 0 END) as needs_fix,
        SUM(CASE WHEN stock = 0 AND (baselineQty IS NULL OR baselineQty = 0) THEN 1 ELSE 0 END) as zero_stock_needs_fix
      FROM products
    `);
    
    console.log(`   Total products: ${before[0].total}`);
    console.log(`   Products with NULL/0 baselineQty: ${before[0].needs_fix}`);
    console.log(`   Products with stock=0 AND NULL/0 baselineQty: ${before[0].zero_stock_needs_fix}`);
    
    if (before[0].needs_fix === 0) {
      console.log('\n✅ All products already have valid baselineQty!');
      await pool.end();
      return;
    }
    
    // Fix products with NULL or 0 baselineQty
    // Strategy: Set baselineQty = max(current stock, 10) for products with stock > 0
    //           Set baselineQty = 10 for products with stock = 0
    console.log('\n🔄 Step 2: Setting baseline quantities...');
    
    // Fix products with stock > 0
    const [result1] = await pool.query(`
      UPDATE products 
      SET baselineQty = GREATEST(stock, 10)
      WHERE (baselineQty IS NULL OR baselineQty = 0)
      AND stock > 0
    `);
    
    console.log(`   ✅ Updated ${result1.affectedRows} product(s) with stock > 0`);
    
    // Fix products with stock = 0 (set to default 10)
    const [result2] = await pool.query(`
      UPDATE products 
      SET baselineQty = 10
      WHERE (baselineQty IS NULL OR baselineQty = 0)
      AND stock = 0
    `);
    
    console.log(`   ✅ Updated ${result2.affectedRows} product(s) with stock = 0 (set to 10)`);
    
    // Check final state
    console.log('\n📊 Step 3: Verifying fix...');
    const [after] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN baselineQty IS NULL OR baselineQty = 0 THEN 1 ELSE 0 END) as still_needs_fix,
        SUM(CASE WHEN stock = 0 AND baselineQty > 0 THEN 1 ELSE 0 END) as ready_for_restock,
        AVG(baselineQty) as avg_baseline,
        MIN(baselineQty) as min_baseline,
        MAX(baselineQty) as max_baseline
      FROM products
    `);
    
    console.log(`   Total products: ${after[0].total}`);
    console.log(`   Products still needing fix: ${after[0].still_needs_fix}`);
    console.log(`   Products ready for restock (stock=0, baselineQty>0): ${after[0].ready_for_restock}`);
    console.log(`   Average baselineQty: ${Math.round(after[0].avg_baseline)}`);
    console.log(`   Min baselineQty: ${after[0].min_baseline}`);
    console.log(`   Max baselineQty: ${after[0].max_baseline}`);
    
    // Show sample of fixed products
    console.log('\n📦 Sample of fixed products:');
    const [samples] = await pool.query(`
      SELECT id, name, shop_id, stock, baselineQty
      FROM products
      WHERE stock = 0 AND baselineQty > 0
      ORDER BY RAND()
      LIMIT 10
    `);
    
    samples.forEach(p => {
      console.log(`   - ID: ${p.id}, Name: ${p.name}, Shop: ${p.shop_id}, Stock: ${p.stock}, BaselineQty: ${p.baselineQty}`);
    });
    
    console.log('\n✅ Baseline quantities fixed successfully!');
    console.log('🔄 Products with stock=0 will now be restocked by the cron job at midnight.');
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixBaselineQty();
