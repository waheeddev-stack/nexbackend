import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

(async () => {
  try {
    console.log('🔧 Verifying Shop ID 79...\n');
    
    const pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: process.env.DB_SSL === 'true' ? { 
        minVersion: 'TLSv1.2', 
        rejectUnauthorized: true 
      } : undefined
    });

    // First check if shop exists
    const [existing] = await pool.query(
      'SELECT id, shop_name, is_verified, home_delivery_active FROM shopkeepers WHERE id = 79'
    );

    if (existing.length === 0) {
      console.log('❌ Shop ID 79 does not exist in database');
      console.log('\n📊 Available shops:');
      const [shops] = await pool.query(
        'SELECT id, shop_name, is_verified FROM shopkeepers ORDER BY id DESC LIMIT 10'
      );
      console.table(shops);
      await pool.end();
      return;
    }

    console.log('Current status:');
    console.table(existing);

    if (existing[0].is_verified === 1) {
      console.log('\n✅ Shop 79 is already verified!');
      console.log('   The 404 error might be due to:');
      console.log('   1. Backend not running');
      console.log('   2. Wrong API URL');
      console.log('   3. Database connection issue');
    } else {
      console.log('\n🔧 Setting is_verified = 1...');
      await pool.query('UPDATE shopkeepers SET is_verified = 1 WHERE id = 79');
      
      const [updated] = await pool.query(
        'SELECT id, shop_name, is_verified, home_delivery_active FROM shopkeepers WHERE id = 79'
      );
      
      console.log('\n✅ Shop 79 verified successfully!');
      console.table(updated);
      console.log('\n📱 Now test the NexKirana app again');
    }

    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\n💡 Check your .env file has correct database credentials');
    process.exit(1);
  }
})();
