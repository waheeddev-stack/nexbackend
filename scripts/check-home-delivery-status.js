import pool from '../config/db.js';

async function checkHomeDeliveryStatus() {
  try {
    console.log('🔍 Checking home_delivery_active status for all shopkeepers...\n');
    
    // Check if column exists
    const [columns] = await pool.query(`
      SHOW COLUMNS FROM shopkeepers LIKE 'home_delivery_active'
    `);
    
    if (columns.length === 0) {
      console.log('❌ Column home_delivery_active does NOT exist in shopkeepers table');
      console.log('   Need to add it with: ALTER TABLE shopkeepers ADD COLUMN home_delivery_active TINYINT(1) DEFAULT 1');
      return;
    }
    
    console.log('✅ Column home_delivery_active exists\n');
    
    // Get all shopkeepers with their home delivery status
    const [shopkeepers] = await pool.query(`
      SELECT id, name, shop_name, is_verified, is_online, home_delivery_active
      FROM shopkeepers
      WHERE is_verified = 1
      ORDER BY id
    `);
    
    console.log(`Found ${shopkeepers.length} verified shopkeepers:\n`);
    
    shopkeepers.forEach(shop => {
      const deliveryStatus = shop.home_delivery_active === 1 ? '✅ ENABLED' : '❌ DISABLED';
      const onlineStatus = shop.is_online === 1 ? '🟢 Online' : '🔴 Offline';
      console.log(`ID: ${shop.id} | ${shop.shop_name || shop.name}`);
      console.log(`   Home Delivery: ${deliveryStatus}`);
      console.log(`   Status: ${onlineStatus}\n`);
    });
    
    // Check the profile endpoint response for a specific shopkeeper
    const testShopId = shopkeepers[0]?.id;
    if (testShopId) {
      console.log(`\n📋 Testing profile endpoint for shopkeeper ID ${testShopId}...\n`);
      const [profile] = await pool.query(`
        SELECT id, email, name, phone, address, shop_name, img, upi_id, upi_qr, 
               latitude, longitude, expo_push_token, is_verified, is_deleted, 
               created_at, home_delivery_active 
        FROM shopkeepers 
        WHERE id = ?
      `, [testShopId]);
      
      if (profile.length > 0) {
        console.log('Profile data returned:');
        console.log(JSON.stringify(profile[0], null, 2));
      }
    }
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

checkHomeDeliveryStatus();
