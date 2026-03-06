/**
 * Fix Product Visibility Issues
 * 
 * This script helps fix common issues preventing products from showing in NexKirana:
 * 1. Add default location to shops without coordinates
 * 2. Restore stock to products (optional)
 * 3. Verify shop status
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import readline from 'readline';

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function fixVisibility() {
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
    console.log('🔧 PRODUCT VISIBILITY FIX TOOL\n');
    console.log('=' .repeat(60));

    // Check current status
    const [shopsNoLocation] = await pool.query(`
      SELECT COUNT(*) as count FROM shopkeepers 
      WHERE (latitude IS NULL OR longitude IS NULL OR latitude = 0 OR longitude = 0)
      AND is_verified = 1
    `);

    const [productsNoStock] = await pool.query(`
      SELECT COUNT(*) as count FROM products 
      WHERE (stock = 0 OR stock IS NULL)
    `);

    console.log(`\n📊 Current Issues:`);
    console.log(`   - ${shopsNoLocation[0].count} verified shops without location`);
    console.log(`   - ${productsNoStock[0].count} products with zero/null stock`);

    console.log('\n\n🎯 FIX OPTIONS:\n');
    console.log('1. Add default location to shops (Bangalore city center)');
    console.log('2. Restore stock to products (set stock = 10 for all)');
    console.log('3. Both fixes');
    console.log('4. Custom: Set specific shop location');
    console.log('5. Exit\n');

    const choice = await question('Select option (1-5): ');

    if (choice === '1' || choice === '3') {
      console.log('\n📍 Adding default location to shops...');
      // Bangalore city center coordinates
      const defaultLat = 12.9716;
      const defaultLng = 77.5946;
      
      const [result] = await pool.query(`
        UPDATE shopkeepers 
        SET latitude = ?, longitude = ?, 
            address = COALESCE(address, 'Bangalore, Karnataka')
        WHERE (latitude IS NULL OR longitude IS NULL OR latitude = 0 OR longitude = 0)
        AND is_verified = 1
      `, [defaultLat, defaultLng]);

      console.log(`✅ Updated ${result.affectedRows} shops with default location`);
    }

    if (choice === '2' || choice === '3') {
      console.log('\n📦 Restoring stock to products...');
      
      const stockAmount = await question('Enter stock amount to set (default 10): ');
      const stock = parseInt(stockAmount) || 10;

      const [result] = await pool.query(`
        UPDATE products 
        SET stock = ?
        WHERE (stock = 0 OR stock IS NULL)
      `, [stock]);

      console.log(`✅ Updated ${result.affectedRows} products with stock = ${stock}`);
    }

    if (choice === '4') {
      console.log('\n🏪 Custom Shop Location Setup\n');
      
      const [shops] = await pool.query(`
        SELECT id, name, shop_name, phone 
        FROM shopkeepers 
        WHERE (latitude IS NULL OR longitude IS NULL OR latitude = 0 OR longitude = 0)
        AND is_verified = 1
        LIMIT 10
      `);

      if (shops.length === 0) {
        console.log('✅ All verified shops have locations!');
      } else {
        console.log('Available shops:');
        shops.forEach((shop, idx) => {
          console.log(`${idx + 1}. ${shop.shop_name || shop.name} (ID: ${shop.id}, Phone: ${shop.phone})`);
        });

        const shopIdx = await question('\nSelect shop number: ');
        const selectedShop = shops[parseInt(shopIdx) - 1];

        if (selectedShop) {
          const lat = await question('Enter latitude: ');
          const lng = await question('Enter longitude: ');
          const address = await question('Enter address (optional): ');

          const [result] = await pool.query(`
            UPDATE shopkeepers 
            SET latitude = ?, longitude = ?, address = COALESCE(NULLIF(?, ''), address)
            WHERE id = ?
          `, [parseFloat(lat), parseFloat(lng), address, selectedShop.id]);

          console.log(`✅ Updated shop ${selectedShop.shop_name || selectedShop.name}`);
        }
      }
    }

    // Show final status
    console.log('\n\n📊 FINAL STATUS:\n');
    
    const [finalShops] = await pool.query(`
      SELECT COUNT(*) as count FROM shopkeepers 
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL 
      AND latitude != 0 AND longitude != 0
      AND is_verified = 1 AND (is_online = 1 OR is_online IS NULL)
    `);

    const [finalProducts] = await pool.query(`
      SELECT COUNT(*) as count FROM products p
      JOIN shopkeepers s ON p.shop_id = s.id
      WHERE p.stock > 0 
      AND s.is_verified = 1 
      AND (s.is_online = 1 OR s.is_online IS NULL)
      AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    `);

    console.log(`✅ ${finalShops[0].count} shops are now visible (verified, online, with location)`);
    console.log(`✅ ${finalProducts[0].count} products are now visible (in stock, from visible shops)`);

    console.log('\n💡 TIP: Test in NexKirana app by:');
    console.log('   1. Enabling location permissions');
    console.log('   2. Opening the Shop tab');
    console.log('   3. Products should now appear!');

    console.log('\n' + '='.repeat(60));

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
    rl.close();
  }
}

fixVisibility();
