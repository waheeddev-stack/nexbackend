import pool from '../config/db.js';

async function diagnoseShops() {
  try {
    console.log('🔍 Diagnosing shop data...\n');

    // Check total shops
    const [allShops] = await pool.query('SELECT COUNT(*) as total FROM shopkeepers');
    console.log(`📊 Total shops in database: ${allShops[0].total}`);

    // Check shops with coordinates
    const [shopsWithCoords] = await pool.query(
      `SELECT COUNT(*) as total FROM shopkeepers 
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL 
       AND latitude != 0 AND longitude != 0`
    );
    console.log(`📍 Shops with valid coordinates: ${shopsWithCoords[0].total}`);

    // Check verified shops
    const [verifiedShops] = await pool.query(
      'SELECT COUNT(*) as total FROM shopkeepers WHERE is_verified = 1'
    );
    console.log(`✅ Verified shops: ${verifiedShops[0].total}`);

    // Check online shops
    const [onlineShops] = await pool.query(
      'SELECT COUNT(*) as total FROM shopkeepers WHERE is_online = 1 OR is_online IS NULL'
    );
    console.log(`🟢 Online shops: ${onlineShops[0].total}`);

    // Check shops that meet all criteria
    const [readyShops] = await pool.query(
      `SELECT COUNT(*) as total FROM shopkeepers 
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL 
       AND latitude != 0 AND longitude != 0
       AND is_verified = 1
       AND (is_online = 1 OR is_online IS NULL)`
    );
    console.log(`🎯 Shops ready to show (verified, online, with coords): ${readyShops[0].total}\n`);

    // List all shops with their status
    const [shops] = await pool.query(
      `SELECT id, name, shop_name, latitude, longitude, is_verified, is_online, address
       FROM shopkeepers
       ORDER BY id`
    );

    console.log('📋 Shop Details:\n');
    shops.forEach(shop => {
      const hasCoords = shop.latitude && shop.longitude && shop.latitude !== 0 && shop.longitude !== 0;
      const isVerified = shop.is_verified === 1;
      const isOnline = shop.is_online === 1 || shop.is_online === null;
      const isReady = hasCoords && isVerified && isOnline;

      console.log(`Shop ID: ${shop.id}`);
      console.log(`  Name: ${shop.name}`);
      console.log(`  Shop Name: ${shop.shop_name || 'N/A'}`);
      console.log(`  Address: ${shop.address || 'N/A'}`);
      console.log(`  Coordinates: ${hasCoords ? `${shop.latitude}, ${shop.longitude}` : '❌ Missing'}`);
      console.log(`  Verified: ${isVerified ? '✅' : '❌'}`);
      console.log(`  Online: ${isOnline ? '✅' : '❌'}`);
      console.log(`  Ready to show: ${isReady ? '✅ YES' : '❌ NO'}`);
      console.log('');
    });

    // Check products for ready shops
    if (readyShops[0].total > 0) {
      const [productsCount] = await pool.query(
        `SELECT s.id, s.shop_name, COUNT(p.id) as product_count, 
                SUM(CASE WHEN p.stock > 0 THEN 1 ELSE 0 END) as in_stock_count
         FROM shopkeepers s
         LEFT JOIN products p ON s.id = p.shop_id
         WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL 
         AND s.latitude != 0 AND s.longitude != 0
         AND s.is_verified = 1
         AND (s.is_online = 1 OR s.is_online IS NULL)
         GROUP BY s.id, s.shop_name`
      );

      console.log('📦 Products per ready shop:\n');
      productsCount.forEach(shop => {
        console.log(`Shop ID ${shop.id} (${shop.shop_name}):`);
        console.log(`  Total products: ${shop.product_count || 0}`);
        console.log(`  In stock: ${shop.in_stock_count || 0}`);
        console.log('');
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

diagnoseShops();
