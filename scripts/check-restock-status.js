/**
 * Check Restock Status
 * Diagnose why products with stock=0 are not being restocked
 */

import dotenv from 'dotenv';
import pool from '../config/db.js';

dotenv.config();

async function checkRestockStatus() {
  try {
    console.log('\n🔍 Checking Restock System Status...\n');
    
    // Check table structure
    console.log('📊 Step 1: Checking products table structure...');
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products'
      AND COLUMN_NAME IN ('stock', 'baselineQty', 'restockAt')
    `, [process.env.DB_NAME]);
    
    if (columns.length === 0) {
      console.log('❌ ERROR: Required columns not found!');
      await pool.end();
      return;
    }
    
    columns.forEach(col => {
      console.log(`   ✅ ${col.COLUMN_NAME}: ${col.DATA_TYPE} (Nullable: ${col.IS_NULLABLE}, Default: ${col.COLUMN_DEFAULT || 'NULL'})`);
    });
    
    // Check products statistics
    console.log('\n📈 Step 2: Checking products statistics...');
    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END) as zero_stock,
        SUM(CASE WHEN baselineQty > 0 THEN 1 ELSE 0 END) as has_baseline,
        SUM(CASE WHEN baselineQty IS NULL THEN 1 ELSE 0 END) as null_baseline,
        SUM(CASE WHEN stock = 0 AND baselineQty > 0 THEN 1 ELSE 0 END) as needs_restock
      FROM products
    `);
    
    console.log(`   Total products: ${stats[0].total}`);
    console.log(`   Products with stock = 0: ${stats[0].zero_stock}`);
    console.log(`   Products with baselineQty > 0: ${stats[0].has_baseline}`);
    console.log(`   Products with baselineQty = NULL: ${stats[0].null_baseline}`);
    console.log(`   Products needing restock (stock=0 AND baselineQty>0): ${stats[0].needs_restock}`);
    
    // Show sample products that need restocking
    if (stats[0].needs_restock > 0) {
      console.log('\n📦 Step 3: Sample products that need restocking:');
      const [samples] = await pool.query(`
        SELECT id, name, shop_id, stock, baselineQty
        FROM products
        WHERE stock = 0 AND baselineQty > 0
        LIMIT 10
      `);
      
      samples.forEach(p => {
        console.log(`   - ID: ${p.id}, Name: ${p.name}, Shop: ${p.shop_id}`);
        console.log(`     Stock: ${p.stock}, BaselineQty: ${p.baselineQty}`);
      });
    } else {
      console.log('\n✅ Step 3: No products currently need restocking');
    }
    
    // Check if cron would work
    console.log('\n🔄 Step 4: Testing restock query (DRY RUN)...');
    const [testResult] = await pool.query(`
      SELECT COUNT(*) as would_restock
      FROM products
      WHERE baselineQty > 0 AND stock = 0
    `);
    
    console.log(`   Would restock ${testResult[0].would_restock} product(s) if cron runs now`);
    
    // Check for products with NULL or 0 baselineQty
    console.log('\n⚠️  Step 5: Checking for problematic products...');
    const [problems] = await pool.query(`
      SELECT 
        SUM(CASE WHEN stock = 0 AND (baselineQty IS NULL OR baselineQty = 0) THEN 1 ELSE 0 END) as zero_stock_no_baseline
      FROM products
    `);
    
    if (problems[0].zero_stock_no_baseline > 0) {
      console.log(`   ⚠️  Found ${problems[0].zero_stock_no_baseline} product(s) with stock=0 but baselineQty is NULL or 0`);
      console.log('   These products will NOT be restocked by the cron job!');
      
      const [problemSamples] = await pool.query(`
        SELECT id, name, shop_id, stock, baselineQty
        FROM products
        WHERE stock = 0 AND (baselineQty IS NULL OR baselineQty = 0)
        LIMIT 5
      `);
      
      console.log('\n   Sample problematic products:');
      problemSamples.forEach(p => {
        console.log(`   - ID: ${p.id}, Name: ${p.name}, Shop: ${p.shop_id}, Stock: ${p.stock}, BaselineQty: ${p.baselineQty || 'NULL'}`);
      });
    } else {
      console.log('   ✅ No problematic products found');
    }
    
    console.log('\n✅ Diagnosis complete!\n');
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkRestockStatus();
