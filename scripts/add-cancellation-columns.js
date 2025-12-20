/**
 * Add cancellation tracking columns to orders table
 * This script adds cancelled_by and cancellation_reason columns
 */

import pool from '../config/db.js';

async function addCancellationColumns() {
  try {
    console.log('Starting migration: Add cancellation columns to orders table...\n');

    // Check if columns already exist
    console.log('Checking if columns already exist...');
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'orders' 
      AND COLUMN_NAME IN ('cancelled_by', 'cancellation_reason')
    `);

    const existingColumns = columns.map(col => col.COLUMN_NAME);
    console.log('Existing cancellation columns:', existingColumns);

    // Add cancelled_by column if it doesn't exist
    if (!existingColumns.includes('cancelled_by')) {
      console.log('\nAdding cancelled_by column...');
      await pool.query(`
        ALTER TABLE orders 
        ADD COLUMN cancelled_by VARCHAR(20) NULL AFTER status
      `);
      console.log('✓ cancelled_by column added successfully');
    } else {
      console.log('✓ cancelled_by column already exists');
    }

    // Add cancellation_reason column if it doesn't exist
    if (!existingColumns.includes('cancellation_reason')) {
      console.log('\nAdding cancellation_reason column...');
      await pool.query(`
        ALTER TABLE orders 
        ADD COLUMN cancellation_reason TEXT NULL AFTER cancelled_by
      `);
      console.log('✓ cancellation_reason column added successfully');
    } else {
      console.log('✓ cancellation_reason column already exists');
    }

    // Verify the columns were added
    console.log('\nVerifying columns...');
    const [verifyColumns] = await pool.query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'orders' 
      AND COLUMN_NAME IN ('cancelled_by', 'cancellation_reason')
      ORDER BY ORDINAL_POSITION
    `);

    console.log('\nColumn details:');
    verifyColumns.forEach(col => {
      console.log(`  - ${col.COLUMN_NAME}: ${col.DATA_TYPE}, Nullable: ${col.IS_NULLABLE}, Default: ${col.COLUMN_DEFAULT || 'NULL'}`);
    });

    // Check existing cancelled orders
    console.log('\nChecking existing cancelled orders...');
    const [cancelledOrders] = await pool.query(`
      SELECT id, status, cancelled_by, cancellation_reason, created_at
      FROM orders 
      WHERE status = 'Cancelled' 
      ORDER BY created_at DESC
      LIMIT 5
    `);

    if (cancelledOrders.length > 0) {
      console.log(`Found ${cancelledOrders.length} cancelled orders (showing up to 5):`);
      cancelledOrders.forEach(order => {
        console.log(`  Order #${order.id}: cancelled_by=${order.cancelled_by || 'NULL'}, reason=${order.cancellation_reason || 'NULL'}`);
      });
    } else {
      console.log('No cancelled orders found in database');
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Deploy the updated backend code to production');
    console.log('2. Test order cancellation from both shopkeeper and customer apps');
    console.log('3. Verify cancellation reasons appear in customer order history');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the migration
addCancellationColumns();
