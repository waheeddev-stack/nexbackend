import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function fixTiDBAutoIncrement() {
  console.log('🔧 Fixing TiDB Cloud AUTO_INCREMENT issue...\n');
  
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    ssl: { rejectUnauthorized: true }
  });

  try {
    // Step 1: Delete broken records first
    console.log('Step 1: Deleting broken records...');
    const [deleteResult] = await pool.query('DELETE FROM shopkeepers WHERE id = 0 OR id IS NULL OR id < 1');
    console.log(`  ✅ Deleted ${deleteResult.affectedRows} broken record(s)\n`);
    
    // Step 2: Find max ID
    console.log('Step 2: Finding current max ID...');
    const [rows] = await pool.query('SELECT MAX(id) as max_id FROM shopkeepers');
    const maxId = rows[0].max_id || 0;
    console.log(`  Current max ID: ${maxId}\n`);
    
    // Step 3: Check table structure
    console.log('Step 3: Checking table structure...');
    const [columns] = await pool.query("SHOW COLUMNS FROM shopkeepers LIKE 'id'");
    console.log('  ID column:', JSON.stringify(columns[0], null, 2));
    
    // Step 4: Try multiple methods to set AUTO_INCREMENT
    console.log('\nStep 4: Attempting to set AUTO_INCREMENT...');
    
    const nextId = maxId + 1;
    
    // Method 1: Standard ALTER TABLE
    try {
      await pool.query(`ALTER TABLE shopkeepers AUTO_INCREMENT = ${nextId}`);
      console.log(`  ✅ Method 1: ALTER TABLE succeeded`);
    } catch (err) {
      console.log(`  ⚠️  Method 1 failed: ${err.message}`);
    }
    
    // Method 2: Force AUTO_INCREMENT by inserting and deleting a record
    try {
      console.log(`  Trying Method 2: Force next ID to ${nextId}...`);
      
      // Insert a dummy record to force the next ID
      const [insertResult] = await pool.query(
        `INSERT INTO shopkeepers (id, name, email, password, phone, shop_name) VALUES (?, ?, ?, ?, ?, ?)`,
        [nextId, 'TEMP', `temp-${Date.now()}@temp.com`, 'temp', '0000000000', 'TEMP']
      );
      
      console.log(`  Inserted temp record with ID: ${insertResult.insertId}`);
      
      // Delete it immediately
      await pool.query('DELETE FROM shopkeepers WHERE email LIKE ?', ['temp-%@temp.com']);
      console.log(`  ✅ Method 2: Forced next ID`);
    } catch (err) {
      console.log(`  ⚠️  Method 2 failed: ${err.message}`);
    }
    
    // Step 5: Verify
    console.log('\nStep 5: Verifying fix...');
    const [status] = await pool.query("SHOW TABLE STATUS LIKE 'shopkeepers'");
    console.log(`  AUTO_INCREMENT value: ${status[0].Auto_increment}`);
    
    const [brokenCheck] = await pool.query('SELECT COUNT(*) as count FROM shopkeepers WHERE id = 0 OR id IS NULL OR id < 1');
    console.log(`  Broken records: ${brokenCheck[0].count}`);
    
    // Step 6: Test with actual insert
    console.log('\nStep 6: Testing with actual insert...');
    const testEmail = `test-${Date.now()}@test.com`;
    
    try {
      const [testInsert] = await pool.query(
        `INSERT INTO shopkeepers (name, email, password, phone, shop_name) VALUES (?, ?, ?, ?, ?)`,
        ['Test Shop', testEmail, 'test123', '1234567890', 'Test Shop']
      );
      
      console.log(`  ✅ Test insert succeeded!`);
      console.log(`  New shopkeeper ID: ${testInsert.insertId}`);
      
      if (testInsert.insertId > 0) {
        console.log(`  ✅ AUTO_INCREMENT is working!`);
        
        // Clean up test record
        await pool.query('DELETE FROM shopkeepers WHERE email = ?', [testEmail]);
        console.log(`  Cleaned up test record`);
      } else {
        console.log(`  ❌ AUTO_INCREMENT still broken (got ID: ${testInsert.insertId})`);
      }
    } catch (err) {
      console.log(`  ❌ Test insert failed: ${err.message}`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Fix completed!');
    console.log('='.repeat(60));
    console.log('\nNext steps:');
    console.log('1. Try shopkeeper signup in the app');
    console.log('2. Check if new shopkeeper appears in admin panel');
    console.log('3. If still failing, the table may need to be recreated');
    
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error(err);
  } finally {
    await pool.end();
  }
}

fixTiDBAutoIncrement();
