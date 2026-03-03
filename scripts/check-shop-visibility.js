/**
 * Check Shop Visibility Status
 * 
 * This script checks why shops might not be visible in the NexKirana app
 * Run: node scripts/check-shop-visibility.js
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function checkShopVisibility() {
  try {
    console.log('🔍 Checking shop visibility status...\n');

    // Get all shops with their status
    const [shops] = await pool.query(`
      SELECT 
        id,
        name,
        shop_name,
        email,
        is_verified,
        is_online,
        latitude,
        longitude,
        created_at,
        (SELECT COUNT(*) FROM products WHERE shop_id = shopkeepers.id) as total_products,
        (SELECT COUNT(*) FROM products WHERE shop_id = shopkeepers.id AND stock > 0) as products_with_stock
      FROM shopkeepers
      ORDER BY created_at DESC
      LIMIT 20
    `);

    console.log(`Found ${shops.length} shops (showing last 20):\n`);

    shops.forEach((shop, index) => {
      const issues = [];
      
      // Check verification
      if (shop.is_verified === 0) {
        issues.push('❌ NOT VERIFIED');
      } else {
        issues.push('✅ Verified');
      }

      // Check online status
      if (shop.is_online === 0) {
        issues.push('📴 OFFLINE');
      } else if (shop.is_online === 1) {
        issues.push('🟢 Online');
      } else {
        issues.push('⚪ Online status not set (treated as online)');
      }

      // Check coordinates
      if (!shop.latitude || !shop.longitude || shop.latitude === 0 || shop.longitude === 0) {
        issues.push('📍 NO COORDINATES');
      } else {
        issues.push(`📍 Coords: ${shop.latitude}, ${shop.longitude}`);
      }

      // Check products
      if (shop.total_products === 0) {
        issues.push('📦 NO PRODUCTS');
      } else if (shop.products_with_stock === 0) {
        issues.push(`📦 ${shop.total_products} products but ALL OUT OF STOCK`);
      } else {
        issues.push(`📦 ${shop.products_with_stock}/${shop.total_products} products in stock`);
      }

      const visibility = (shop.is_verified === 1 && 
                         (shop.is_online === 1 || shop.is_online === null) && 
                         shop.latitude && shop.longitude && 
                         shop.products_with_stock > 0) 
                         ? '👁️ VISIBLE' : '🚫 HIDDEN';

      console.log(`${index + 1}. ${shop.shop_name || shop.name} (ID: ${shop.id})`);
      console.log(`   ${visibility}`);
      console.log(`   ${issues.join(' | ')}`);
      console.log(`   Created: ${new Date(shop.created_at).toLocaleString()}`);
      console.log('');
    });

    // Summary
    const [summary] = await pool.query(`
      SELECT 
        COUNT(*) as total_shops,
        SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as verified_shops,
        SUM(CASE WHEN is_verified = 0 THEN 1 ELSE 0 END) as unverified_shops,
        SUM(CASE WHEN is_online = 1 OR is_online IS NULL THEN 1 ELSE 0 END) as online_shops,
        SUM(CASE WHEN is_online = 0 THEN 1 ELSE 0 END) as offline_shops,
        SUM(CASE WHEN latitude IS NULL OR longitude IS NULL OR latitude = 0 OR longitude = 0 THEN 1 ELSE 0 END) as shops_without_coords
      FROM shopkeepers
    `);

    console.log('📊 Summary:');
    console.log(`   Total shops: ${summary[0].total_shops}`);
    console.log(`   Verified: ${summary[0].verified_shops}`);
    console.log(`   Unverified: ${summary[0].unverified_shops}`);
    console.log(`   Online: ${summary[0].online_shops}`);
    console.log(`   Offline: ${summary[0].offline_shops}`);
    console.log(`   Without coordinates: ${summary[0].shops_without_coords}`);

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkShopVisibility();
