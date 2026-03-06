/**
 * Add baselineQty Column to Products Table
 * 
 * This adds the baselineQty column that the restock cron will use
 * to restore stock levels at midnight daily.
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function addBaselineQtyColumn() {
  const dbSsl = process.env.DB_SSL && process.env.DB_SSL.trim().toLowerCase() === "true";
  const sslConfig = dbSsl ? { rejectUnauthorized: false } : undefined;

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 4000,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: sslConfig,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4'
  });

  try {
    console.log('🔧 ADDING BASELINE QUANTITY COLUMN\n');
    console.log('=' .repeat(60));

    // Check if column already exists
    console.log('\n📊 Step 1: Checking if baselineQty column exists...');
    
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME = 'products' 
      AND COLUMN_NAME = 'baselineQty'
    `, [process.env.DB_NAME]);

    if (columns.length > 0) {
      console.log('   ✅ baselineQty column already exists');
    } else {
      console.log('   ➕ Adding baselineQty column...');
      
      await pool.query(`
        ALTER TABLE products 
        ADD COLUMN baselineQty INT DEFAULT 10 AFTER stock
      `);
      
      console.log('   ✅ baselineQty column added successfully');
    }

    // Set baselineQty = current stock for existing products
    console.log('\n📦 Step 2: Setting baseline quantities...');
    
    const [result] = await pool.query(`
      UPDATE products 
      SET baselineQty = GREATEST(stock, 10)
      WHERE baselineQty IS NULL OR baselineQty = 0
    `);

    console.log(`   ✅ Updated ${result.affectedRows} products with baseline quantities`);

    // Show statistics
    console.log('\n📊 Step 3: Statistics...');
    
    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) as total_products,
        AVG(stock) as avg_stock,
        AVG(baselineQty) as avg_baseline,
        MIN(baselineQty) as min_baseline,
        MAX(baselineQty) as max_baseline
      FROM products
    `);

    console.log(`   Total products: ${stats[0].total_products}`);
    console.log(`   Average stock: ${Math.round(stats[0].avg_stock || 0)}`);
    console.log(`   Average baseline: ${Math.round(stats[0].avg_baseline || 0)}`);
    console.log(`   Baseline range: ${stats[0].min_baseline} - ${stats[0].max_baseline}`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ BASELINE QUANTITY COLUMN SETUP COMPLETE!\n');
    
    console.log('📝 What was done:');
    console.log('   1. Added baselineQty column to products table');
    console.log('   2. Set baseline = max(current stock, 10) for all products');
    console.log('   3. Default value for new products: 10');
    
    console.log('\n🔄 How the restock system works:');
    console.log('   - When customers buy products, stock decreases');
    console.log('   - At midnight (12:00 AM), cron job runs');
    console.log('   - All products with stock < baselineQty are restocked');
    console.log('   - Stock is set back to baselineQty value');
    
    console.log('\n💡 Shopkeepers can:');
    console.log('   - Update baselineQty in their app for each product');
    console.log('   - Set baselineQty = 0 to disable auto-restock for a product');
    console.log('   - Adjust baselineQty based on demand');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

addBaselineQtyColumn();
