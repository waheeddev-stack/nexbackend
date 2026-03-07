import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
};

async function addCancellationReasonColumn() {
  let connection;
  
  try {
    console.log('🔌 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected to database');

    // Check if column already exists
    console.log('\n📋 Checking if cancellation_reason column exists...');
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'orders' 
        AND COLUMN_NAME = 'cancellation_reason'
    `, [process.env.DB_NAME]);

    if (columns.length > 0) {
      console.log('ℹ️  Column cancellation_reason already exists in orders table');
      return;
    }

    // Add the column
    console.log('\n➕ Adding cancellation_reason column to orders table...');
    await connection.query(`
      ALTER TABLE orders 
      ADD COLUMN cancellation_reason TEXT NULL 
      AFTER status
    `);
    console.log('✅ Successfully added cancellation_reason column');

    // Verify the column was added
    console.log('\n🔍 Verifying column addition...');
    const [verifyColumns] = await connection.query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'orders' 
        AND COLUMN_NAME = 'cancellation_reason'
    `, [process.env.DB_NAME]);

    if (verifyColumns.length > 0) {
      console.log('✅ Column verified:');
      console.log(verifyColumns[0]);
    }

    console.log('\n✅ Database migration completed successfully!');
    console.log('\n📝 Summary:');
    console.log('   - Added cancellation_reason column (TEXT, NULL)');
    console.log('   - Positioned after status column');
    console.log('   - Ready to store shopkeeper cancellation reasons');

  } catch (error) {
    console.error('❌ Error during migration:', error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Database connection closed');
    }
  }
}

// Run the migration
addCancellationReasonColumn()
  .then(() => {
    console.log('\n🎉 Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration script failed:', error);
    process.exit(1);
  });
