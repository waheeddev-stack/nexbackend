import pool from '../config/db.js';

async function addShopOnlineStatus() {
  console.log('🚀 Starting migration: Add is_online column to shopkeepers table...\n');
  
  try {
    const connection = await pool.getConnection();
    
    // Check if column already exists
    console.log('📋 Checking if is_online column already exists...');
    const [columns] = await connection.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME = 'shopkeepers' 
       AND COLUMN_NAME = 'is_online'`
    );
    
    if (columns.length > 0) {
      console.log('✅ Column is_online already exists. Skipping migration.');
      connection.release();
      process.exit(0);
    }
    
    // Add the is_online column
    console.log('➕ Adding is_online column...');
    await connection.execute(
      `ALTER TABLE shopkeepers ADD COLUMN is_online TINYINT(1) DEFAULT 1`
    );
    console.log('✅ Column is_online added successfully!');
    
    // Create index for faster queries
    console.log('📊 Creating index on is_online column...');
    try {
      await connection.execute(
        `CREATE INDEX idx_shopkeepers_online ON shopkeepers(is_online)`
      );
      console.log('✅ Index created successfully!');
    } catch (indexErr) {
      if (indexErr.code === 'ER_DUP_KEYNAME') {
        console.log('ℹ️ Index already exists, skipping...');
      } else {
        console.log('⚠️ Index creation warning:', indexErr.message);
      }
    }
    
    // Verify the migration
    console.log('\n📋 Verifying migration...');
    const [result] = await connection.execute(
      `SELECT COUNT(*) as total, SUM(CASE WHEN is_online = 1 OR is_online IS NULL THEN 1 ELSE 0 END) as online 
       FROM shopkeepers`
    );
    console.log(`✅ Total shopkeepers: ${result[0].total}`);
    console.log(`✅ Online shopkeepers: ${result[0].online}`);
    
    connection.release();
    console.log('\n🎉 Migration completed successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

addShopOnlineStatus();
