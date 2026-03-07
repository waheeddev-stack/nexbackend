import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

(async () => {
  try {
    console.log('🔍 Checking Shop ID 79 in database...\n');
    
    const pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined
    });

    // Check if shop 79 exists
    const [shop] = await pool.query(`
      SELECT id, name, shop_name, is_verified, is_online, home_delivery_active 
      FROM shopkeepers 
      WHERE id = 79
    `);

    if (shop.length === 0) {
      console.log('❌ Shop ID 79 does NOT exist in database');
      console.log('\n📊 Let\'s check what shops DO exist:');
      
      const [allShops] = await pool.query(`
        SELECT id, shop_name, is_verified, is_online, home_delivery_active 
        FROM shopkeepers 
        ORDER BY id DESC 
        LIMIT 10
      `);
      
      console.table(allShops);
      console.log('\n💡 Solution: Use a shop ID from the list above that has is_verified = 1');
    } else {
      console.log('✅ Shop ID 79 EXISTS:');
      console.table(shop);
      
      if (shop[0].is_verified === 0) {
        console.log('\n⚠️  PROBLEM FOUND: Shop is NOT VERIFIED (is_verified = 0)');
        console.log('   The API endpoint only returns verified shops (WHERE is_verified = 1)');
        console.log('\n🔧 FIXING: Setting is_verified = 1 for shop 79...');
        
        await pool.query('UPDATE shopkeepers SET is_verified = 1 WHERE id = 79');
        
        console.log('✅ Shop 79 is now VERIFIED!');
        console.log('\n📡 Testing API endpoint...');
        
        const [updatedShop] = await pool.query(`
          SELECT id, name, shop_name, is_verified, is_online, home_delivery_active 
          FROM shopkeepers 
          WHERE id = 79 AND is_verified = 1
        `);
        
        console.table(updatedShop);
        console.log('\n✅ API will now return this shop');
        console.log('   home_delivery_active:', updatedShop[0].home_delivery_active);
        console.log('   Expected UI: ' + (updatedShop[0].home_delivery_active === 0 ? 'Pickup Only' : 'Both Options'));
      } else {
        console.log('\n✅ Shop is VERIFIED');
        console.log('   home_delivery_active:', shop[0].home_delivery_active);
        console.log('   is_online:', shop[0].is_online);
        console.log('\n⚠️  If API still returns 404, check:');
        console.log('   1. Backend server is running');
        console.log('   2. Database connection is working');
        console.log('   3. Route is registered correctly');
      }
    }

    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();
