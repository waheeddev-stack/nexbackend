import 'dotenv/config';
import pool from '../config/db.js';

async function addSoftDeleteColumns() {
  try {
    console.log('🚀 Adding soft delete columns to shopkeepers table...\n');

    // Check if columns already exist
    console.log('🔍 Checking existing columns...');
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'shopkeepers'
      AND COLUMN_NAME IN ('is_deleted', 'deleted_at')
    `);

    const existingColumns = columns.map(c => c.COLUMN_NAME);
    console.log('Existing soft delete columns:', existingColumns);

    // Add is_deleted column if it doesn't exist
    if (!existingColumns.includes('is_deleted')) {
      console.log('\n➕ Adding is_deleted column...');
      await pool.query(`
        ALTER TABLE shopkeepers 
        ADD COLUMN is_deleted TINYINT(1) DEFAULT 0
      `);
      console.log('✅ is_deleted column added');
    } else {
      console.log('✅ is_deleted column already exists');
    }

    // Add deleted_at column if it doesn't exist
    if (!existingColumns.includes('deleted_at')) {
      console.log('\n➕ Adding deleted_at column...');
      await pool.query(`
        ALTER TABLE shopkeepers 
        ADD COLUMN deleted_at DATETIME NULL
      `);
      console.log('✅ deleted_at column added');
    } else {
      console.log('✅ deleted_at column already exists');
    }

    // Add index for better query performance
    console.log('\n➕ Adding index on is_deleted...');
    try {
      await pool.query(`
        ALTER TABLE shopkeepers 
        ADD INDEX idx_is_deleted (is_deleted)
      `);
      console.log('✅ Index added');
    } catch (err) {
      if (err.message.includes('Duplicate key name')) {
        console.log('✅ Index already exists');
      } else {
        throw err;
      }
    }

    // Verify columns were added
    console.log('\n🔍 Verifying columns...');
    const [allColumns] = await pool.query(`
      SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'shopkeepers'
      AND COLUMN_NAME IN ('is_deleted', 'deleted_at')
    `);

    console.log('\nColumn details:');
    allColumns.forEach(col => {
      console.log(`  - ${col.COLUMN_NAME}: ${col.COLUMN_TYPE} (default: ${col.COLUMN_DEFAULT}, nullable: ${col.IS_NULLABLE})`);
    });

    // Check existing data
    console.log('\n📊 Checking existing shopkeepers...');
    const [shopkeepers] = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(CASE WHEN is_deleted = 0 THEN 1 END) as active,
             COUNT(CASE WHEN is_deleted = 1 THEN 1 END) as deleted
      FROM shopkeepers
    `);

    console.log(`Total shopkeepers: ${shopkeepers[0].total}`);
    console.log(`Active: ${shopkeepers[0].active}`);
    console.log(`Deleted: ${shopkeepers[0].deleted}`);

    console.log('\n✅ Soft delete columns added successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Restart your backend server (Render.com will auto-deploy)');
    console.log('   2. Refresh your admin panel');
    console.log('   3. Shopkeepers list should now load correctly');

    process.exit(0);
  } catch (err) {
    console.error('❌ Error adding soft delete columns:', err);
    console.error('Error details:', err.message);
    process.exit(1);
  }
}

addSoftDeleteColumns();
