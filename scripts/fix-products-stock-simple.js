/**
 * Simple Fix: Restore Product Stock
 * 
 * The issue: Products have stock = 0, so they don't show in NexKirana app.
 * 
 * This script:
 * 1. Sets stock = 10 for all products with stock = 0 or NULL
 * 2. Adds location to shops without coordinates
 * 3. Ensures shops are verified and online
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function fixProductsStock() {
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
    console.log('🔧 FIXING PRODUCT STOCK LEVELS\n');
    console.log('=' .repeat(60));

    // Step 1: Check current state
    console.log('\n📊 Step 1: Analyzing current state...');
    
    const [productsZeroStock] = await pool.query(`
      SELECT COUNT(*) as count FROM products 
      WHERE stock IS NULL OR stock = 0
    `);
    
    const [shopsNoLocation] = await pool.query(`
      SELECT COUNT(*) as count FROM shopkeepers 
      WHERE (latitude IS NULL OR longitude IS NULL OR latitude = 0 OR longitude = 0)
      AND is_verified = 1
    `);

    console.log(`   - Products with stock = 0 or NULL: ${productsZeroStock[0].count}`);
    console.log(`   - Shops without location: ${shopsNoLocation[0].count}`);

    // Step 2: Restore stock
    console.log('\n📦 Step 2: Restoring stock to products...');
    
    const [stockResult] = await pool.query(`
      UPDATE products 
      SET stock = 10
      WHERE stock IS NULL OR stock = 0
    `);

    console.log(`   ✅ Updated ${stockResult.affectedRows} products (stock set to 10)`);

    // Step 3: Fix shop locations
    console.log('\n📍 Step 3: Adding location to shops...');
    const defaultLat = 12.9716; // Bangalore city center
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

    // Step 4: Update inventory_products table if it exists
    console.log('\n🗄️  Step 4: Checking inventory_products table...');
    
    try {
      const [inventoryExists] = await pool.query(`
        SELECT COUNT(*) as count 
        FROM information_schema.tables 
        WHERE table_schema = ? AND table_name = 'inventory_products'
      `, [process.env.DB_NAME]);

      if (inventoryExists[0].count > 0) {
        console.log('   Found inventory_products table, updating...');
        
        // Set baselineQty = 10 for inventory products
        const [invBaselineResult] = await pool.query(`
          UPDATE inventory_products 
          SET baselineQty = 10
          WHERE baselineQty IS NULL OR baselineQty = 0
        `);
        
        // Restore stock to baselineQty
        const [invStockResult] = await pool.query(`
          UPDATE inventory_products 
          SET stock = GREATEST(stock, 10),
              restockAt = NULL
          WHERE stock < 10 OR stock IS NULL
        `);

        console.log(`   ✅ Updated ${invBaselineResult.affectedRows} inventory baseline quantities`);
        console.log(`   ✅ Updated ${invStockResult.affectedRows} inventory stock levels`);
      } else {
        console.log('   ℹ️  inventory_products table not found (OK)');
      }
    } catch (err) {
      console.log('   ⚠️  Could not update inventory_products:', err.message);
    }

    // Step 5: Verify results
    console.log('\n✅ Step 5: Verifying results...');
    
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

    const [totalProducts] = await pool.query(`
      SELECT COUNT(*) as count FROM products
    `);

    const [avgStock] = await pool.query(`
      SELECT AVG(stock) as avg FROM products WHERE stock > 0
    `);

    console.log(`   ✅ ${visibleShops[0].count} shops are visible`);
    console.log(`   ✅ ${visibleProducts[0].count} / ${totalProducts[0].count} products are visible`);
    console.log(`   📊 Average stock: ${Math.round(avgStock[0].avg || 0)}`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ PRODUCT STOCK FIX COMPLETE!\n');
    
    console.log('📝 What was fixed:');
    console.log('   1. Stock set to 10 for all out-of-stock products');
    console.log('   2. Shop locations added (Bangalore default)');
    console.log('   3. Shops set to verified and online');
    console.log('   4. Inventory baseline quantities updated (if table exists)');
    
    console.log('\n⚠️  IMPORTANT - About the Restock System:');
    console.log('   - The inventory restock cron runs daily at midnight');
    console.log('   - It restores stock to baselineQty for products with stock = 0');
    console.log('   - Since products table has no baselineQty column, the cron');
    console.log('     only affects the inventory_products table');
    console.log('   - Regular products in the products table are NOT auto-restocked');
    console.log('   - Shopkeepers must manually restock via the app');
    
    console.log('\n🎯 Next steps:');
    console.log('   1. Open NexKirana app');
    console.log('   2. Enable location permissions');
    console.log('   3. Go to Shop tab');
    console.log('   4. Products should now be visible!');
    
    console.log('\n💡 To prevent stock from going to zero:');
    console.log('   - Shopkeepers should regularly check and restock products');
    console.log('   - Or disable the inventory deduction system if not needed');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

fixProductsStock();
