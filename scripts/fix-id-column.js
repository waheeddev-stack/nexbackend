import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function fixIdColumn() {
  console.log('🔧 Fixing shopkeepers.id column to be AUTO_INCREMENT...\n');
  
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    ssl: { rejectUnauthorized: true }
  });

  try {
    // Step 1: Check current structure
    console.log('Step 1: Current table structure...');
    const [columns] = await pool.query("SHOW COLUMNS FROM shopkeepers LIKE 'id'");
    console.log('  Current:', JSON.stringify(columns[0], null, 2));
    
    // Step 2: Delete any broken records
    console.log('\nStep 2: Cleaning broken records...');
    const [deleteResult] = await pool.query('DELETE FROM shopkeepers WHERE id = 0 OR id IS NULL OR id < 1');
    console.log(`  ✅ Deleted ${deleteResult.affectedRows} broken record(s)`);
    
    // Step 3: Find max ID
    const [rows] = await pool.query('SELECT MAX(id) as max_id FROM shopkeepers');
    const maxId = rows[0].max_id || 0;
    console.log(`  Current max ID: ${maxId}`);
    
    // Step 4: Alter the id column to be AUTO_INCREMENT PRIMARY KEY
    console.log('\nStep 3: Altering id column to AUTO_INCREMENT...');
    
    try {
      // First, make sure id is NOT NULL
      await pool.query('ALTER TABLE shopkeepers MODIFY COLUMN id BIGINT NOT NULL');
      console.log('  ✅ Set id to NOT NULL');
      
      // Then add PRIMARY KEY if not exists
      try {
        await pool.query('ALTER TABLE shopkeepers ADD PRIMARY KEY (id)');
        console.log('  ✅ Added PRIMARY KEY');
      } catch (err) {
        if (err.message.includes('Multiple primary key')) {
          console.log('  ℹ️  PRIMARY KEY already exists');
        } else {
          throw err;
        }
      }
      
      // Finally, set AUTO_INCREMENT
      await pool.query(`ALTER TABLE shopkeepers MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT`);
      console.log('  ✅ Set AUTO_INCREMENT');
      
      // Set the starting value
      const nextId = maxId + 1;
      await pool.query(`ALTER TABLE shopkeepers AUTO_INCREMENT = ${nextId}`);
      console.log(`  ✅ Set AUTO_INCREMENT start value to ${nextId}`);
      
    } catch (err) {
      console.error('  ❌ Error altering column:', err.message);
      throw err;
    }
    
    // Step 5: Verify
    console.log('\nStep 4: Verifying changes...');
    const [newColumns] = await pool.query("SHOW COLUMNS FROM shopkeepers LIKE 'id'");
    console.log('  New structure:', JSON.stringify(newColumns[0], null, 2));
    
    const [status] = await pool.query("SHOW TABLE STATUS LIKE 'shopkeepers'");
    console.log(`  AUTO_INCREMENT value: ${status[0].Auto_increment}`);
    
    // Step 6: Test insert
    console.log('\nStep 5: Testing with actual insert...');
    const testEmail = `test-${Date.now()}@test.com`;
    
    const [testInsert] = await pool.query(
      `INSERT INTO shopkeepers (name, email, password, phone, shop_name) VALUES (?, ?, ?, ?, ?)`,
      ['Test Shop', testEmail, 'test123', '1234567890', 'Test Shop']
    );
    
    console.log(`  New shopkeeper ID: ${testInsert.insertId}`);
    
    if (testInsert.insertId > 0 && testInsert.insertId > maxId) {
      console.log(`  ✅ AUTO_INCREMENT is WORKING!`);
      
      // Clean up
      await pool.query('DELETE FROM shopkeepers WHERE email = ?', [testEmail]);
      console.log(`  Cleaned up test record`);
      
      console.log('\n' + '='.repeat(60));
      console.log('✅ SUCCESS! AUTO_INCREMENT is now working!');
      console.log('='.repeat(60));
      console.log('\nYou can now:');
      console.log('1. Try shopkeeper signup in the app');
      console.log('2. New shopkeepers will get proper IDs');
      console.log('3. They will appear in admin panel');
    } else {
      console.log(`  ❌ Still broken (got ID: ${testInsert.insertId})`);
    }
    
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error(err);
  } finally {
    await pool.end();
  }
}

fixIdColumn();
