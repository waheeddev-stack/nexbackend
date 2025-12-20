import pool from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Remove cancelled_by and cancellation_reason columns from orders table
 * These columns were causing orders to not display
 */

async function removeCancellationColumns() {
  console.log('🔧 Removing cancellation columns from orders table...\n');

  try {
    // Check if columns exist
    console.log('1. Checking if columns exist...');
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'orders' 
        AND TABLE_SCHEMA = DATABASE()
        AND COLUMN_NAME IN ('cancelled_by', 'cancellation_reason')
    `);

    if (columns.length === 0) {
      console.log('✅ Columns do not exist. Nothing to remove.');
      await pool.end();
      return;
    }

    console.log(`Found ${columns.length} column(s) to remove:`);
    columns.forEach(col => console.log(`   - ${col.COLUMN_NAME}`));

    // Remove cancelled_by column
    if (columns.some(c => c.COLUMN_NAME === 'cancelled_by')) {
      console.log('\n2. Removing cancelled_by column...');
      try {
        await pool.query('ALTER TABLE orders DROP COLUMN cancelled_by');
        console.log('✅ cancelled_by column removed');
      } catch (error) {
        if (error.message.includes('does not exist')) {
          console.log('ℹ️ cancelled_by column does not exist');
        } else {
          throw error;
        }
      }
    }

    // Remove cancellation_reason column
    if (columns.some(c => c.COLUMN_NAME === 'cancellation_reason')) {
      console.log('\n3. Removing cancellation_reason column...');
      try {
        await pool.query('ALTER TABLE orders DROP COLUMN cancellation_reason');
        console.log('✅ cancellation_reason column removed');
      } catch (error) {
        if (error.message.includes('does not exist')) {
          console.log('ℹ️ cancellation_reason column does not exist');
        } else {
          throw error;
        }
      }
    }

    // Verify removal
    console.log('\n4. Verifying columns are removed...');
    const [remainingColumns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'orders' 
        AND TABLE_SCHEMA = DATABASE()
        AND COLUMN_NAME IN ('cancelled_by', 'cancellation_reason')
    `);

    if (remainingColumns.length === 0) {
      console.log('✅ All cancellation columns successfully removed!');
    } else {
      console.warn('⚠️ Some columns still exist:', remainingColumns.map(c => c.COLUMN_NAME));
    }

    // Show current orders table structure
    console.log('\n5. Current orders table structure:');
    const [allColumns] = await pool.query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'orders' 
        AND TABLE_SCHEMA = DATABASE()
      ORDER BY ORDINAL_POSITION
    `);

    console.log('\nOrders table columns:');
    allColumns.forEach(col => {
      console.log(`   ${col.COLUMN_NAME.padEnd(25)} ${col.DATA_TYPE.padEnd(15)} ${col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });

    console.log('\n✅ Migration complete! Orders should now display correctly.');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the migration
removeCancellationColumns();
