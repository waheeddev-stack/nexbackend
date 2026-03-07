import pool from '../config/db.js';

async function debugShopInfo404() {
  try {
    console.log('🔍 Debugging Shop Info 404 Error\n');
    
    // Get all verified shops
    const [verifiedShops] = await pool.query(`
      SELECT id, name, shop_name, is_verified, is_online, home_delivery_active
      FROM shopkeepers
      WHERE is_verified = 1
      ORDER BY id
    `);
    
    console.log(`Found ${verifiedShops.length} verified shops:\n`);
    
    if (verifiedShops.length === 0) {
      console.log('❌ No verified shops found!');
      console.log('   This is why you get 404 errors.\n');
      
      // Check unverified shops
      const [unverifiedShops] = await pool.query(`
        SELECT id, name, shop_name, is_verified, is_online
        FROM shopkeepers
        WHERE is_verified = 0 OR is_verified IS NULL
        ORDER BY id
      `);
      
      console.log(`Found ${unverifiedShops.length} UNVERIFIED shops:`);
      unverifiedShops.slice(0, 10).forEach(shop => {
        console.log(`  ID ${shop.id}: ${shop.shop_name || shop.name} (is_verified: ${shop.is_verified})`);
      });
      
      process.exit(1);
    }
    
    // Show first 10 verified shops
    console.log('Verified shops available:');
    verifiedShops.slice(0, 10).forEach(shop => {
      const delivery = shop.home_delivery_active === 1 ? '✅ Enabled' : '❌ Disabled';
      const online = shop.is_online === 1 ? '🟢 Online' : '🔴 Offline';
      console.log(`  ID ${shop.id}: ${shop.shop_name || shop.name}`);
      console.log(`     ${online} | Home Delivery: ${delivery}`);
    });
    
    // Test the endpoint query for first shop
    const testShopId = verifiedShops[0].id;
    console.log(`\n\n🧪 Testing endpoint query for shop ID ${testShopId}...\n`);
    
    const [shop] = await pool.query(`
      SELECT id, name, shop_name, address, phone, latitude, longitude, 
             is_online, is_verified, home_delivery_active
      FROM shopkeepers 
      WHERE id = ? AND is_verified = 1
    `, [testShopId]);
    
    if (shop.length === 0) {
      console.log('❌ Query returned no results (this would cause 404)');
    } else {
      console.log('✅ Query successful:');
      console.log(JSON.stringify({ success: true, shop: shop[0] }, null, 2));
    }
    
    // Check what shop IDs are in cart items
    console.log('\n\n💡 Common Issues:\n');
    console.log('1. Cart items have invalid shop IDs (shop doesn\'t exist)');
    console.log('2. Cart items reference unverified shops');
    console.log('3. Shop ID field name mismatch (shopId vs shop_id)');
    console.log('4. Cart has items from deleted shops');
    
    console.log('\n\n📋 To fix:');
    console.log('1. Clear cart in NexKirana app');
    console.log('2. Search for nearby shops again');
    console.log('3. Add products from a verified shop');
    console.log(`4. Use one of these shop IDs: ${verifiedShops.slice(0, 5).map(s => s.id).join(', ')}`);
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err);
    process.exit(1);
  }
}

debugShopInfo404();
