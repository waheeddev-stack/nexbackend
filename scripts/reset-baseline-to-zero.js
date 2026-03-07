/**
 * Reset Baseline Quantities to Zero
 * 
 * This script resets all baselineQty values to 0 so shopkeepers can set them properly.
 * The restock system will only work for products where shopkeepers explicitly set baselineQty > 0.
 */

import dotenv from 'dotenv';
import pool from '../config/db.js';

dotenv.config();

async function resetBaselineToZero() {
  try {
    console.log('\n🔄 Resetting Baseline Quantities to Zero...\n');
    
    // Check current state
    console.log('📊 Step 1: Checking current state...');
    const [before] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN baselineQty > 0 THEN 1 ELSE 0 END) as has_baseline,
        SUM(CASE WHEN baselineQty IS NULL OR baselineQty = 0 THEN 1 ELSE 0 END) as no_baseline
      FROM products
    `);
    
    console.log(`   Total products: ${before[0].total}`);
    console.log(`   Products with baselineQty > 0: ${before[0].has_baseline}`);
    console.log(`   Products with baselineQty = 0 or NULL: ${before[0].no_baseline}`);
    
    if (before[0].has_baseline === 0) {
      console.log('\n✅ All products already have baselineQty = 0 or NULL!');
      await pool.end();
      return;
    }
    
    // Reset all baselineQty to 0
    console.log('\n🔄 Step 2: Resetting all baselineQty to 0...');
    const [result] = await pool.query(`
      UPDATE products 
      SET baselineQty = 0
      WHERE baselineQty IS NOT NULL AND baselineQty > 0
    `);
    
    console.log(`   ✅ Reset ${result.affectedRows} product(s) to baselineQty = 0`);
    
    // Verify final state
    console.log('\n📊 Step 3: Verifying reset...');
    const [after] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN baselineQty > 0 THEN 1 ELSE 0 END) as has_baseline,
        SUM(CASE WHEN baselineQty IS NULL OR baselineQty = 0 THEN 1 ELSE 0 END) as no_baseline
      FROM products
    `);
    
    console.log(`   Total products: ${after[0].total}`);
    console.log(`   Products with baselineQty > 0: ${after[0].has_baseline}`);
    console.log(`   Products with baselineQty = 0 or NULL: ${after[0].no_baseline}`);
    
    console.log('\n✅ Baseline quantities reset successfully!');
    console.log('📱 Shopkeepers can now set baseline quantities in their app.');
    console.log('🔄 Only products with baselineQty > 0 will be auto-restocked.');
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

resetBaselineToZero();
