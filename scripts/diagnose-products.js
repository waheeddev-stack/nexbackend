/**
 * Diagnostic Script: Check why products aren't showing from shopkeeper to NexKirana
 * 
 * This script checks:
 * 1. Shopkeeper accounts and their verification status
 * 2. Products in the database and their stock levels
 * 3. Shop online/offline status
 * 4. Location data validity
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function diagnose() {
  // Use SSL configuration for TiDB Cloud
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
    console.log('🔍 PRODUCT VISIBILITY DIAGNOSTIC\n');
    console.log('=' .repeat(60));

    // 1. Check shopkeepers
    console.log('\n📊 SHOPKEEPER STATUS:');
    const [shopkeepers] = await pool.query(`
      SELECT id, name, shop_name, phone, email, 
             is_verified, is_online, 
             latitude, longitude, address,
             created_at
      FROM shopkeepers
      ORDER BY created_at DESC
      LIMIT 10
    `);

    if (shopkeepers.length === 0) {
      console.log('❌ No shopkeepers found in database!');
    } else {
      shopkeepers.forEach(shop => {
        console.log(`\n  Shop ID: ${shop.id}`);
        console.log(`  Name: ${shop.shop_name || shop.name}`);
        console.log(`  Phone: ${shop.phone}`);
        console.log(`  Verified: ${shop.is_verified ? '✅ YES' : '❌ NO'}`);
        console.log(`  Online: ${shop.is_online ? '✅ YES' : '❌ NO'}`);
        console.log(`  Location: ${shop.latitude && shop.longitude ? `✅ (${shop.latitude}, ${shop.longitude})` : '❌ Missing'}`);
        console.log(`  Address: ${shop.address || '❌ Not set'}`);
      });
    }

    // 2. Check products
    console.log('\n\n📦 PRODUCTS STATUS:');
    const [products] = await pool.query(`
      SELECT p.id, p.shop_id, p.name, p.price, p.stock, p.category,
             s.shop_name, s.is_verified, s.is_online,
             p.created_at
      FROM products p
      LEFT JOIN shopkeepers s ON p.shop_id = s.id
      ORDER BY p.created_at DESC
      LIMIT 20
    `);

    if (products.length === 0) {
      console.log('❌ No products found in database!');
    } else {
      console.log(`\nTotal products: ${products.length}`);
      
      const productsWithStock = products.filter(p => p.stock > 0);
      const productsFromVerifiedShops = products.filter(p => p.is_verified === 1);
      const productsFromOnlineShops = products.filter(p => p.is_online === 1);
      const visibleProducts = products.filter(p => p.stock > 0 && p.is_verified === 1 && p.is_online === 1);

      console.log(`Products with stock > 0: ${productsWithStock.length}`);
      console.log(`Products from verified shops: ${productsFromVerifiedShops.length}`);
      console.log(`Products from online shops: ${productsFromOnlineShops.length}`);
      console.log(`✅ VISIBLE products (stock>0, verified, online): ${visibleProducts.length}`);

      console.log('\n  Recent products:');
      products.slice(0, 10).forEach(p => {
        const visible = p.stock > 0 && p.is_verified === 1 && p.is_online === 1;
        console.log(`\n  ${visible ? '✅' : '❌'} Product ID: ${p.id}`);
        console.log(`     Name: ${p.name}`);
        console.log(`     Shop: ${p.shop_name || `ID ${p.shop_id}`}`);
        console.log(`     Price: ₹${p.price}`);
        console.log(`     Stock: ${p.stock} ${p.stock > 0 ? '✅' : '❌ OUT OF STOCK'}`);
        console.log(`     Category: ${p.category || 'None'}`);
        console.log(`     Shop Verified: ${p.is_verified ? '✅' : '❌'}`);
        console.log(`     Shop Online: ${p.is_online ? '✅' : '❌'}`);
      });
    }

    // 3. Check for common issues
    console.log('\n\n⚠️  COMMON ISSUES CHECK:');
    
    const [unverifiedShops] = await pool.query(`
      SELECT COUNT(*) as count FROM shopkeepers WHERE is_verified = 0
    `);
    if (unverifiedShops[0].count > 0) {
      console.log(`❌ ${unverifiedShops[0].count} unverified shops (products won't show)`);
    }

    const [offlineShops] = await pool.query(`
      SELECT COUNT(*) as count FROM shopkeepers WHERE is_online = 0
    `);
    if (offlineShops[0].count > 0) {
      console.log(`❌ ${offlineShops[0].count} offline shops (products won't show)`);
    }

    const [noLocationShops] = await pool.query(`
      SELECT COUNT(*) as count FROM shopkeepers 
      WHERE latitude IS NULL OR longitude IS NULL OR latitude = 0 OR longitude = 0
    `);
    if (noLocationShops[0].count > 0) {
      console.log(`❌ ${noLocationShops[0].count} shops without location (won't appear in nearby search)`);
    }

    const [outOfStockProducts] = await pool.query(`
      SELECT COUNT(*) as count FROM products WHERE stock = 0 OR stock IS NULL
    `);
    if (outOfStockProducts[0].count > 0) {
      console.log(`❌ ${outOfStockProducts[0].count} products with zero/null stock (won't show)`);
    }

    // 4. Recommendations
    console.log('\n\n💡 RECOMMENDATIONS:');
    console.log('To make products visible in NexKirana app, ensure:');
    console.log('  1. Shopkeeper is_verified = 1');
    console.log('  2. Shopkeeper is_online = 1 (or NULL)');
    console.log('  3. Shopkeeper has valid latitude/longitude');
    console.log('  4. Products have stock > 0');
    console.log('  5. Products belong to verified, online shops');

    console.log('\n' + '='.repeat(60));

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

diagnose();
