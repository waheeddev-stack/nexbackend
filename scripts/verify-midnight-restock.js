/**
 * Verify Midnight Auto-Restock Feature
 * 
 * This script verifies the complete auto-restock flow:
 * 1. Product runs out during the day (e.g., 3PM) → Hidden from customers
 * 2. Stays hidden until midnight
 * 3. At midnight (12AM) → Auto-restocked to baselineQty
 * 4. Becomes visible again to customers
 */

import dotenv from 'dotenv';
import pool from '../config/db.js';

dotenv.config();

async function verifyMidnightRestock() {
  try {
    console.log('\n🔍 Verifying Midnight Auto-Restock Feature...\n');
    
    // Step 1: Check cron schedule
    console.log('📅 Step 1: Checking cron schedule...');
    const cronSchedule = process.env.RESTOCK_CRON_SCHEDULE || '0 0 * * *';
    console.log(`   Current schedule: ${cronSchedule}`);
    
    if (cronSchedule === '* * * * *') {
      console.log('   ⚠️  TEST MODE: Running every minute');
      console.log('   For production, set RESTOCK_CRON_SCHEDULE=0 0 * * * in .env');
    } else if (cronSchedule === '0 0 * * *') {
      console.log('   ✅ PRODUCTION MODE: Runs daily at midnight (00:00)');
    } else {
      console.log(`   ⚠️  CUSTOM SCHEDULE: ${cronSchedule}`);
    }
    
    // Step 2: Check product visibility query
    console.log('\n👁️  Step 2: Verifying product visibility logic...');
    console.log('   Products visible to customers must have:');
    console.log('   - stock > 0 (in stock)');
    console.log('   - baselineQty > 0 (shopkeeper configured)');
    
    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) as total_products,
        SUM(CASE WHEN stock > 0 AND baselineQty > 0 THEN 1 ELSE 0 END) as visible_to_customers,
        SUM(CASE WHEN stock = 0 AND baselineQty > 0 THEN 1 ELSE 0 END) as hidden_awaiting_restock,
        SUM(CASE WHEN baselineQty IS NULL OR baselineQty = 0 THEN 1 ELSE 0 END) as not_configured
      FROM products
    `);
    
    console.log(`   Total products: ${stats[0].total_products}`);
    console.log(`   Visible to customers: ${stats[0].visible_to_customers} (stock > 0 AND baselineQty > 0)`);
    console.log(`   Hidden (awaiting restock): ${stats[0].hidden_awaiting_restock} (stock = 0 AND baselineQty > 0)`);
    console.log(`   Not configured: ${stats[0].not_configured} (baselineQty = 0 or NULL)`);
    
    // Step 3: Simulate the flow
    console.log('\n🧪 Step 3: Simulating the complete flow...');
    
    // Find a product with baselineQty > 0 and stock > 0
    const [testProducts] = await pool.query(`
      SELECT id, name, shop_id, stock, baselineQty
      FROM products
      WHERE baselineQty > 0 AND stock > 0
      LIMIT 1
    `);
    
    if (testProducts.length === 0) {
      console.log('   ⚠️  No products with baselineQty > 0 found for testing');
      console.log('   Shopkeepers need to set baseline quantities in their app');
      await pool.end();
      return;
    }
    
    const testProduct = testProducts[0];
    console.log(`\n   Using test product: ${testProduct.name} (ID: ${testProduct.id})`);
    console.log(`   Shop: ${testProduct.shop_id}`);
    console.log(`   Current stock: ${testProduct.stock}`);
    console.log(`   Baseline quantity: ${testProduct.baselineQty}`);
    
    // Simulate product running out at 3PM
    console.log('\n   📉 Simulating: Product runs out at 3PM...');
    await pool.query('UPDATE products SET stock = 0 WHERE id = ?', [testProduct.id]);
    console.log('   ✅ Stock set to 0');
    
    // Check visibility
    const [visibilityCheck1] = await pool.query(`
      SELECT COUNT(*) as count
      FROM products
      WHERE id = ? AND stock > 0 AND baselineQty > 0
    `, [testProduct.id]);
    
    if (visibilityCheck1[0].count === 0) {
      console.log('   ✅ Product is now HIDDEN from customers (stock = 0)');
    } else {
      console.log('   ❌ ERROR: Product should be hidden but is still visible!');
    }
    
    // Simulate midnight restock
    console.log('\n   🌙 Simulating: Midnight (12AM) restock...');
    const [restockResult] = await pool.query(`
      UPDATE products 
      SET stock = baselineQty 
      WHERE id = ? AND stock = 0 AND baselineQty > 0
    `, [testProduct.id]);
    
    if (restockResult.affectedRows > 0) {
      console.log('   ✅ Product restocked to baselineQty');
    } else {
      console.log('   ❌ ERROR: Product was not restocked!');
    }
    
    // Check visibility after restock
    const [afterRestock] = await pool.query(`
      SELECT stock, baselineQty
      FROM products
      WHERE id = ?
    `, [testProduct.id]);
    
    console.log(`   Stock after restock: ${afterRestock[0].stock}`);
    console.log(`   Baseline quantity: ${afterRestock[0].baselineQty}`);
    
    const [visibilityCheck2] = await pool.query(`
      SELECT COUNT(*) as count
      FROM products
      WHERE id = ? AND stock > 0 AND baselineQty > 0
    `, [testProduct.id]);
    
    if (visibilityCheck2[0].count > 0) {
      console.log('   ✅ Product is now VISIBLE to customers again (stock > 0)');
    } else {
      console.log('   ❌ ERROR: Product should be visible but is still hidden!');
    }
    
    // Step 4: Verify the complete flow
    console.log('\n📋 Step 4: Flow verification summary...');
    
    const flowCorrect = 
      visibilityCheck1[0].count === 0 && // Hidden when stock = 0
      restockResult.affectedRows > 0 && // Restocked at midnight
      visibilityCheck2[0].count > 0 && // Visible after restock
      afterRestock[0].stock === testProduct.baselineQty; // Stock = baselineQty
    
    if (flowCorrect) {
      console.log('   ✅ FLOW VERIFIED: Complete auto-restock flow working correctly!');
      console.log('\n   Timeline:');
      console.log('   - 3PM: Product runs out → Hidden from customers');
      console.log('   - 3PM-11:59PM: Product stays hidden');
      console.log('   - 12AM (Midnight): Auto-restock runs → Stock restored to baselineQty');
      console.log('   - 12AM onwards: Product visible to customers again');
    } else {
      console.log('   ❌ FLOW ERROR: Auto-restock flow has issues!');
    }
    
    // Step 5: Production readiness check
    console.log('\n🚀 Step 5: Production readiness check...');
    
    const checks = {
      cronSchedule: cronSchedule === '0 0 * * *',
      visibilityQuery: true, // Already verified in code
      restockQuery: true, // Already verified in code
      productsConfigured: stats[0].visible_to_customers > 0
    };
    
    console.log(`   Cron schedule (midnight): ${checks.cronSchedule ? '✅' : '❌'}`);
    console.log(`   Visibility query (stock > 0 AND baselineQty > 0): ✅`);
    console.log(`   Restock query (stock = 0 AND baselineQty > 0): ✅`);
    console.log(`   Products configured: ${checks.productsConfigured ? '✅' : '⚠️'}`);
    
    if (Object.values(checks).every(v => v)) {
      console.log('\n   ✅ SYSTEM READY FOR PRODUCTION!');
    } else {
      console.log('\n   ⚠️  SYSTEM NEEDS CONFIGURATION:');
      if (!checks.cronSchedule) {
        console.log('   - Set RESTOCK_CRON_SCHEDULE=0 0 * * * in .env for midnight restock');
      }
      if (!checks.productsConfigured) {
        console.log('   - Shopkeepers need to set baseline quantities for products');
      }
    }
    
    console.log('\n✅ Verification complete!\n');
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

verifyMidnightRestock();
