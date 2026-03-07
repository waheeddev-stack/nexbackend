import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function fixAutoIncrement() {
  console.log('🔧 Starting database AUTO_INCREMENT fix...\n');
  
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    ssl: { rejectUnauthorized: true }
  });

  try {
    // Step 1: Find max ID
    console.log('Step 1: Finding current max ID...');
    const [rows] = await pool.query('SELECT MAX(id) as max_id FROM shopkeepers');
    const maxId = rows[0].max_id || 0;
    const nextId = maxId + 1;
    
    console.log(`  Current max ID: ${maxId}`);
    console.log(`  Next ID will be: ${nextId}\n`);
    
    // Step 2: Set AUTO_INCREMENT
    console.log('Step 2: Setting AUTO_INCREMENT...');
    await pool.query(`ALTER TABLE shopkeepers AUTO_INCREMENT = ${nextId}`);
    console.log(`  ✅ AUTO_INCREMENT set to ${nextId}\n`);
    
    // Step 3: Delete broken records
    console.log('Step 3: Deleting broken records (id = 0 or NULL)...');
    const [result] = await pool.query('DELETE FROM shopkeepers WHERE id = 0 OR id IS NULL');
    console.log(`  ✅ Deleted ${result.affectedRows} broken record(s)\n`);
    
    // Step 4: Verify
    console.log('Step 4: Verifying changes...');
    const [status] = await pool.query("SHOW TABLE STATUS LIKE 'shopkeepers'");
    console.log(`  Current AUTO_INCREMENT: ${status[0].Auto_increment}`);
    
    const [verifyRows] = await pool.query('SELECT COUNT(*) as count FROM shopkeepers WHERE id = 0 OR id IS NULL');
    console.log(`  Broken records remaining: ${verifyRows[0].count}\n`);
    
    console.log('✅ Database fix completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Try shopkeeper signup again');
    console.log('2. Check admin panel for new pending shopkeeper');
    console.log('3. Approve and test');
    
  } catch (err) {
    console.error('❌ Error fixing database:', err.message);
    console.error('\nTroubleshooting:');
    console.error('1. Check your .env file has correct database credentials');
    console.error('2. Verify TiDB Cloud cluster is running');
    console.error('3. Check if your IP is whitelisted in TiDB Cloud');
  } finally {
    await pool.end();
  }
}

fixAutoIncrement();
