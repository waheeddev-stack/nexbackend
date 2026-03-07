/**
 * Verify Cron Job Configuration and Functionality
 * 
 * This script comprehensively tests the restock cron job:
 * 1. Checks cron schedule configuration
 * 2. Verifies cron syntax is valid
 * 3. Tests the restock query
 * 4. Simulates a complete restock cycle
 */

import dotenv from 'dotenv';
import cron from 'node-cron';
import pool from '../config/db.js';

dotenv.config();

async function verifyCronJob() {
  try {
    console.log('\n🔍 Verifying Cron Job Configuration and Functionality...\n');
    
    // Step 1: Check environment configuration
    console.log('📅 Step 1: Checking cron schedule configuration...');
    const schedule = process.env.RESTOCK_CRON_SCHEDULE || '0 0 * * *';
    console.log(`   Schedule from .env: ${schedule}`);
    
    // Validate cron syntax
    const isValid = cron.validate(schedule);
    if (isValid) {
      console.log('   ✅ Cron syntax is VALID');
    } else {
      console.log('   ❌ Cron syntax is INVALID!');
      await pool.end();
      return;
    }
    
    // Explain schedule
    if (schedule === '0 0 * * *') {
      console.log('   📅 Schedule: Daily at midnight (00:00)');
      console.log('   Mode: PRODUCTION');
    } else if (schedule === '* * * * *') {
      console.log('   📅 Schedule: Every minute');
      console.log('   Mode: TEST');
    } else {
      console.log(`   📅 Schedule: Custom (${schedule})`);
    }
    
    // Step 2: Check if cron module is working
    console.log('\n⚙️  Step 2: Testing cron module...');
    let testCronRan = false;
    const testCron = cron.schedule('* * * * * *', () => {
      testCronRan = true;
    });
    
    await new Promise(resolve => setTimeout(resolve, 1500));
    testCron.stop();
    
    if (testCronRan) {
      console.log('   ✅ Cron module is working correctly');
    } else {
      console.log('   ❌ Cron module failed to execute!');
    }
    
    // Step 3: Test the restock query
    console.log('\n🔍 Step 3: Testing restock query...');
    
    // Check current state
    const [beforeStats] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN stock = 0 AND baselineQty > 0 THEN 1 ELSE 0 END) as needs_restock
      FROM products
    `);
    
    console.log(`   Total products: ${beforeStats[0].total}`);
    console.log(`   Products needing restock: ${beforeStats[0].needs_restock}`);
    
    if (beforeStats[0].needs_restock === 0) {
      console.log('   ℹ️  No products currently need restocking');
      console.log('   Creating test scenario...');
      
      // Find a product with baselineQty > 0 or create one
      const [testProducts] = await pool.query(`
        SELECT id, name, stock, baselineQty
        FROM products
        WHERE baselineQty > 0
        LIMIT 1
      `);
      
      let testProductId;
      if (testProducts.length > 0) {
        testProductId = testProducts[0].id;
        console.log(`   Using existing product: ${testProducts[0].name} (ID: ${testProductId})`);
      } else {
        // Set a test product's baseline
        const [anyProduct] = await pool.query(`
          SELECT id, name FROM products LIMIT 1
        `);
        
        if (anyProduct.length === 0) {
          console.log('   ❌ No products in database to test with!');
          await pool.end();
          return;
        }
        
        testProductId = anyProduct[0].id;
        await pool.query(`
          UPDATE products SET baselineQty = 10 WHERE id = ?
        `, [testProductId]);
        console.log(`   Set baseline for product: ${anyProduct[0].name} (ID: ${testProductId})`);
      }
      
      // Set stock to 0
      await pool.query(`
        UPDATE products SET stock = 0 WHERE id = ?
      `, [testProductId]);
      console.log(`   Set stock to 0 for test product`);
    }
    
    // Step 4: Execute the restock query (same as cron job)
    console.log('\n🔄 Step 4: Executing restock query (simulating cron job)...');
    
    const [result] = await pool.query(`
      UPDATE products 
      SET stock = baselineQty 
      WHERE stock = 0 
      AND baselineQty > 0
    `);
    
    const restockedCount = result.affectedRows;
    console.log(`   ✅ Query executed successfully`);
    console.log(`   Products restocked: ${restockedCount}`);
    
    if (restockedCount > 0) {
      // Get sample of restocked products
      const [samples] = await pool.query(`
        SELECT id, name, shop_id, stock, baselineQty
        FROM products
        WHERE baselineQty > 0 AND stock > 0
        ORDER BY RAND()
        LIMIT 5
      `);
      
      console.log('\n   📋 Sample restocked products:');
      samples.forEach(p => {
        console.log(`      - ${p.name} (ID: ${p.id}, Shop: ${p.shop_id}): stock=${p.stock}, baseline=${p.baselineQty}`);
      });
    }
    
    // Step 5: Verify the query logic
    console.log('\n✅ Step 5: Verifying query logic...');
    
    // Check products with stock = 0 and baselineQty > 0 (should be 0 after restock)
    const [afterRestock] = await pool.query(`
      SELECT COUNT(*) as count
      FROM products
      WHERE stock = 0 AND baselineQty > 0
    `);
    
    if (afterRestock[0].count === 0) {
      console.log('   ✅ All products with baselineQty > 0 have been restocked');
    } else {
      console.log(`   ⚠️  ${afterRestock[0].count} product(s) still need restocking`);
    }
    
    // Step 6: Test cron job initialization
    console.log('\n🚀 Step 6: Testing cron job initialization...');
    
    try {
      const { startRestockCron, getRestockCronStatus } = await import('../cron/inventory.restock.cron.js');
      
      console.log('   ✅ Cron module imported successfully');
      
      // Get status
      const status = getRestockCronStatus();
      console.log(`   Cron running: ${status.running}`);
      console.log(`   Cron schedule: ${status.schedule}`);
      console.log(`   Description: ${status.description}`);
      
    } catch (error) {
      console.log('   ❌ Failed to import cron module:', error.message);
    }
    
    // Step 7: Final summary
    console.log('\n📊 Step 7: Final Summary...');
    
    const checks = {
      scheduleValid: isValid,
      cronModuleWorks: testCronRan,
      queryExecutes: restockedCount >= 0,
      logicCorrect: afterRestock[0].count === 0
    };
    
    console.log(`   Cron schedule valid: ${checks.scheduleValid ? '✅' : '❌'}`);
    console.log(`   Cron module works: ${checks.cronModuleWorks ? '✅' : '❌'}`);
    console.log(`   Restock query executes: ${checks.queryExecutes ? '✅' : '❌'}`);
    console.log(`   Restock logic correct: ${checks.logicCorrect ? '✅' : '❌'}`);
    
    const allPassed = Object.values(checks).every(v => v);
    
    if (allPassed) {
      console.log('\n   ✅ ALL CHECKS PASSED - Cron job is ready!');
      console.log('\n   📅 Next steps:');
      console.log('   1. Ensure backend server is running');
      console.log('   2. Cron will run at: ' + (schedule === '0 0 * * *' ? 'midnight (00:00)' : 'every minute (test mode)'));
      console.log('   3. Monitor server logs for restock messages');
    } else {
      console.log('\n   ⚠️  SOME CHECKS FAILED - Review issues above');
    }
    
    console.log('\n✅ Verification complete!\n');
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

verifyCronJob();
