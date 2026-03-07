require('dotenv').config();
const mysql = require('mysql2/promise');

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
    } else {
      console.log('✅ Shop ID 79 EXISTS:');
      console.table(shop);
      
      if (shop[0].is_verified === 0) {
        console.log('\n⚠️  PROBLEM: Shop is NOT VERIFIED (is_verified = 0)');
        console.log('   The API endpoint only returns verified shops');
        console.log('   Solution: Verify the shop in admin panel or database');
      } else {
        console.log('\n✅ Shop is VERIFIED');
        console.log('   home_delivery_active:', shop[0].home_delivery_active);
        console.log('   is_online:', shop[0].is_online);
      }
    }

    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
})();
