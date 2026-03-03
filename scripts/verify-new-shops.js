/**
 * Verify and Enable New Shops
 * 
 * This script verifies unverified shops and sets them online
 * Run: node scripts/verify-new-shops.js [shop_id]
 * 
 * Examples:
 *   node scripts/verify-new-shops.js        # Verify all unverified shops
 *   node scripts/verify-new-shops.js 123    # Verify specific shop ID
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

async function verifyShops(specificShopId = null) {
  try {
    console.log('🔧 Verifying and enabling shops...\n');

    let query, params;
    
    if (specificShopId) {
      query = `
        SELECT id, name, shop_name, email, is_verified, is_online
        FROM shopkeepers
        WHERE id = ?
      `;
      params = [specificShopId];
    } else {
      query = `
        SELECT id, name, shop_name, email, is_verified, is_online
        FROM shopkeepers
        WHERE is_verified = 0
        ORDER BY created_at DESC
      `;
      params = [];
    }

    const [shops] = await pool.query(query, params);

    if (shops.length === 0) {
      if (specificShopId) {
        console.log(`❌ Shop ID ${specificShopId} not found`);
      } else {
        console.log('✅ No unverified shops found. All shops are already verified!');
      }
      await pool.end();
      return;
    }

    console.log(`Found ${shops.length} shop(s) to verify:\n`);

    for (const shop of shops) {
      console.log(`Processing: ${shop.shop_name || shop.name} (ID: ${shop.id})`);
      console.log(`  Email: ${shop.email}`);
      console.log(`  Current status: ${shop.is_verified ? 'Verified' : 'Unverified'}, ${shop.is_online ? 'Online' : 'Offline'}`);

      // Update shop to verified and online
      await pool.query(`
        UPDATE shopkeepers
        SET is_verified = 1, is_online = 1
        WHERE id = ?
      `, [shop.id]);

      console.log(`  ✅ Updated to: Verified, Online\n`);
    }

    console.log(`\n🎉 Successfully verified ${shops.length} shop(s)!`);
    console.log('These shops will now be visible in the NexKirana app.');

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Get shop ID from command line argument
const shopId = process.argv[2] ? parseInt(process.argv[2]) : null;

if (shopId && isNaN(shopId)) {
  console.error('❌ Invalid shop ID. Please provide a valid number.');
  process.exit(1);
}

verifyShops(shopId);
