import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function checkAutoIncrement() {
  console.log('🔍 Checking AUTO_INCREMENT status...\n');
  
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    ssl: { rejectUnauthorized: true }
  });

  try {
    // Check current max ID
    const [rows] = await pool.query('SELECT MAX(id) as max_id FROM shopkeepers');
    console.log('Current max ID:', rows[0].max_id);
    
    // Check AUTO_INCREMENT value
    const [status] = await pool.query("SHOW TABLE STATUS LIKE 'shopkeepers'");
    console.log('AUTO_INCREMENT value:', status[0].Auto_increment);
    
    // Check for broken records
    const [broken] = await pool.query('SELECT COUNT(*) as count FROM shopkeepers WHERE id = 0 OR id IS NULL');
    console.log('Broken records (id=0 or NULL):', broken[0].count);
    
    // List recent shopkeepers
    console.log('\nRecent shopkeepers:');
    const [recent] = await pool.query('SELECT id, email, shop_name, is_verified FROM shopkeepers ORDER BY id DESC LIMIT 5');
    recent.forEach(s => {
      console.log(`  ID ${s.id}: ${s.email} - ${s.shop_name} (verified: ${s.is_verified})`);
    });
    
    // Check if AUTO_INCREMENT is working
    if (status[0].Auto_increment === null) {
      console.log('\n⚠️  AUTO_INCREMENT is NULL - this is the problem!');
      console.log('TiDB Cloud might not support AUTO_INCREMENT the same way as MySQL.');
      console.log('\nTrying alternative fix...');
      
      const maxId = rows[0].max_id || 0;
      const nextId = maxId + 1;
      
      // Try setting it again with explicit value
      await pool.query(`ALTER TABLE shopkeepers AUTO_INCREMENT = ${nextId}`);
      console.log(`Set AUTO_INCREMENT to ${nextId}`);
      
      // Check again
      const [status2] = await pool.query("SHOW TABLE STATUS LIKE 'shopkeepers'");
      console.log('New AUTO_INCREMENT value:', status2[0].Auto_increment);
      
      if (status2[0].Auto_increment === null) {
        console.log('\n❌ AUTO_INCREMENT still NULL after setting');
        console.log('This indicates TiDB Cloud compatibility issue.');
        console.log('\nPossible solutions:');
        console.log('1. Check TiDB Cloud version and compatibility');
        console.log('2. Verify table was created with AUTO_INCREMENT');
        console.log('3. May need to recreate the table');
      }
    } else {
      console.log('\n✅ AUTO_INCREMENT is set correctly!');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkAutoIncrement();
