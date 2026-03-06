/**
 * Fix Shop Locations Only
 * 
 * This script ONLY fixes shop locations - does NOT touch product stock.
 * Shopkeepers will manage their own stock levels.
 * 
 * This script:
 * 1. Adds default Bangalore location to shops without coordinates
 * 2. Ensures shops are verified and online
 * 3. Does NOT modify product stock at all
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function fixShopLocations() {
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
    console.log('📍 FIXING SHOP LOCATIONS ONLY\n');
    console.log('=' .repeat(60));

    // Step 1: Check current state
    console.log('\n📊 Step 1: Analyzing current state...');
    
    const [shopsNoLocation] = await pool.query(`
      SELECT COUNT(*) as count FROM shopkeepers 
      WHERE (latitude IS NULL OR longitude IS NULL OR latitude = 0 OR longitude = 0)
    `);

    const [productsWithStock] = await pool.query(`
      SELECT COUNT(*) as count FROM products WHERE stock > 0
    `);

    console.log(`   - Shops without location: ${shopsNoLocation[0].count}`);
    console.log(`   - Products with stock > 0: ${productsWithStock[0].count}`);

    // Step 2: Fix shop locations ONLY
    console.log('\n📍 Step 2: Adding location to shops...');
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

    console.log(`   ✅ Updated ${locationResult.affectedRows} shops with location`);

    // Step 3: Verify results
    console.log('\n✅ Step 3: Verifying results...');
    
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

    console.log(`   ✅ ${visibleShops[0].count} shops are now visible`);
    console.log(`   ✅ ${visibleProducts[0].count} / ${totalProducts[0].count} products are visible`);
    console.log(`   ℹ️  Product stock levels were NOT modified`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ SHOP LOCATION FIX COMPLETE!\n');
    
    console.log('📝 What was fixed:');
    console.log('   1. Shop locations added (Bangalore default)');
    console.log('   2. Shops set to verified and online');
    console.log('   3. Product stock levels left unchanged');
    
    console.log('\n📦 About Product Stock:');
    console.log('   - Stock levels are managed by shopkeepers');
    console.log('   - Shopkeepers can update stock in their app');
    console.log('   - Products with stock = 0 will not show in NexKirana');
    console.log('   - This is intentional - out of stock = not visible');
    
    console.log('\n🎯 Next steps:');
    console.log('   1. Shopkeepers should open their app');
    console.log('   2. Go to Products/Inventory screen');
    console.log('   3. Update stock levels for products they want to sell');
    console.log('   4. Products with stock > 0 will appear in NexKirana app');
    
    console.log('\n💡 For customers to see products:');
    console.log('   - Open NexKirana app');
    console.log('   - Enable location permissions');
    console.log('   - Go to Shop tab');
    console.log('   - Only products with stock > 0 will be visible');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

fixShopLocations();
