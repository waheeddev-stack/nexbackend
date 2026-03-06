/**
 * Fix Inventory Baseline Quantities
 * 
 * The issue: Products have baselineQty = 0, so when the restock cron runs,
 * it restores stock to 0 instead of a usable quantity.
 * 
 * This script:
 * 1. Sets baselineQty = 10 for all products with baselineQty = 0 or NULL
 * 2. Restores stock to baselineQty for products currently at 0
 * 3. Adds location to shops without coordinates
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function fixInventoryBaseline() {
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
    console.log('🔧 FIXING INVENTORY BASELINE QUANTITIES\n');
    console.log('=' .repeat(60));

    // Step 1: Check current state
    console.log('\n📊 Step 1: Analyzing current state...');
    
    const [productsZeroBaseline] = await pool.query(`
      SELECT COUNT(*) as count FROM products 
      WHERE baselineQty IS NULL OR baselineQty = 0
    `);
    
    const [productsZeroStock] = await pool.query(`
      SELECT COUNT(*) as count FROM products 
      WHERE stock IS NULL OR stock = 0
    `);

    console.log(`   - Products with baselineQty = 0 or NULL: ${productsZeroBaseline[0].count}`);
    console.log(`   - Products with stock = 0 or NULL: ${productsZeroStock[0].count}`);

    // Step 2: Fix baselineQty
    console.log('\n📦 Step 2: Setting baselineQty = 10 for products...');
    
    const [baselineResult] = await pool.query(`
      UPDATE products 
      SET baselineQty = 10
      WHERE baselineQty IS NULL OR baselineQty = 0
    `);

    console.log(`   ✅ Updated ${baselineResult.affectedRows} products`);

    // Step 3: Restore stock to baseline
    console.log('\n🔄 Step 3: Restoring stock to baselineQty...');
    
    const [stockResult] = await pool.query(`
      UPDATE products 
      SET stock = baselineQty
      WHERE stock IS NULL OR stock = 0
    `);

    console.log(`   ✅ Updated ${stockResult.affectedRows} products`);

    // Step 4: Fix shop locations
    console.log('\n📍 Step 4: Adding location to shops...');
    const defaultLat = 12.9716; // Bangalore
    const defaultLng = 77.5946;
    
    const [locationResult] = await pool.query(`
      UPDATE shopkeepers 
      SET latitude = ?, 
          longitude = ?, 
          address = COALESCE(address, 'Bangalore, Karnataka'),
          is_online = COALESCE(is_online, 1),
          is_verified = COALESCE(is_verified, 1)
      WHERE (latitude IS NULL OR longitude IS NULL OR latitude = 0 OR longitude = 0)
    `, [defaultLat, defaultLng]);

    console.log(`   ✅ Updated ${locationResult.affectedRows} shops`);

    // Step 5: Update inventory_products table if it exists
    console.log('\n🗄️  Step 5: Checking inventory_products table...');
    
    try {
      const [inventoryExists] = await pool.query(`
        SELECT COUNT(*) as count 
        FROM information_schema.tables 
        WHERE table_schema = ? AND table_name = 'inventory_products'
      `, [process.env.DB_NAME]);

      if (inventoryExists[0].count > 0) {
        console.log('   Found inventory_products table, updating...');
        
        const [invBaselineResult] = await pool.query(`
          UPDATE inventory_products 
          SET baselineQty = 10
          WHERE baselineQty IS NULL OR baselineQty = 0
        `);
        
        const [invStockResult] = await pool.query(`
          UPDATE inventory_products 
          SET stock = baselineQty,
              restockAt = NULL
          WHERE stock IS NULL OR stock = 0
        `);

        console.log(`   ✅ Updated ${invBaselineResult.affectedRows} inventory baseline quantities`);
        console.log(`   ✅ Updated ${invStockResult.affectedRows} inventory stock levels`);
      } else {
        console.log('   ℹ️  inventory_products table not found (OK)');
      }
    } catch (err) {
      console.log('   ⚠️  Could not update inventory_products:', err.message);
    }

    // Step 6: Verify results
    console.log('\n✅ Step 6: Verifying results...');
    
    const [visibleShops] = await pool.query(`
      SELECT COUNT(*) as count FROM shopkeepers 
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL 
      AND latitude != 0 AND longitude != 0
      AND is_verified = 1 AND (is_online = 1 OR is_online IS NULL)
    `);

    const [visibleProducts] = await pool.query(`
      SELECT COUNT(*) as count FROM products p
      JOIN shopkeepers s ON p.shop_id = s.id
      WHERE p.stock > 0 
      AND s.is_verified = 1 
      AND (s.is_online = 1 OR s.is_online IS NULL)
      AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    `);

    const [avgBaseline] = await pool.query(`
      SELECT AVG(baselineQty) as avg FROM products WHERE baselineQty > 0
    `);

    const [avgStock] = await pool.query(`
      SELECT AVG(stock) as avg FROM products WHERE stock > 0
    `);

    console.log(`   ✅ ${visibleShops[0].count} shops are visible`);
    console.log(`   ✅ ${visibleProducts[0].count} products are visible`);
    console.log(`   📊 Average baselineQty: ${Math.round(avgBaseline[0].avg || 0)}`);
    console.log(`   📊 Average stock: ${Math.round(avgStock[0].avg || 0)}`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ INVENTORY BASELINE FIX COMPLETE!\n');
    
    console.log('📝 What was fixed:');
    console.log('   1. baselineQty set to 10 for all products');
    console.log('   2. Stock restored to baselineQty for out-of-stock products');
    console.log('   3. Shop locations added (Bangalore default)');
    console.log('   4. Shops set to verified and online');
    
    console.log('\n💡 How the restock system works now:');
    console.log('   - When stock reaches 0, it schedules a restock');
    console.log('   - Daily at midnight, cron restores stock to baselineQty (10)');
    console.log('   - Products will now restock to 10 instead of 0!');
    
    console.log('\n🎯 Next steps:');
    console.log('   1. Open NexKirana app');
    console.log('   2. Enable location permissions');
    console.log('   3. Go to Shop tab');
    console.log('   4. Products should now be visible!');
    
    console.log('\n📱 To customize baseline quantities:');
    console.log('   - Use shopkeeper app to edit individual product baselineQty');
    console.log('   - Or update directly in database: UPDATE products SET baselineQty = X WHERE id = Y');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

fixInventoryBaseline();
