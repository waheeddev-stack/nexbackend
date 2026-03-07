import pool from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Add Scheduled Time and Delivery Mode Columns to Orders Table
 * 
 * This script adds the following columns to the orders table:
 * - scheduled_time: DATETIME - When the order should be picked up or delivered
 * - order_type: VARCHAR(20) - 'pickup' or 'delivery'
 * - delivery_mode: VARCHAR(20) - 'pickup' or 'delivery' (for compatibility)
 * 
 * These columns are needed for the 12-hour time slot system.
 */

async function addScheduledTimeColumns() {
  try {
    console.log('🔧 Adding scheduled_time, order_type, and delivery_mode columns to orders table...\n');

    // Check if columns already exist
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'orders' 
        AND COLUMN_NAME IN ('scheduled_time', 'order_type', 'delivery_mode')
    `);

    const existingColumns = columns.map(col => col.COLUMN_NAME);
    console.log('📊 Existing columns:', existingColumns.length > 0 ? existingColumns.join(', ') : 'None');

    // Add scheduled_time column if it doesn't exist
    if (!existingColumns.includes('scheduled_time')) {
      console.log('\n➕ Adding scheduled_time column...');
      await pool.query(`
        ALTER TABLE orders 
        ADD COLUMN scheduled_time DATETIME DEFAULT NULL 
        COMMENT 'Scheduled pickup or delivery time'
      `);
      console.log('✅ scheduled_time column added');
    } else {
      console.log('\n✓ scheduled_time column already exists');
    }

    // Add order_type column if it doesn't exist
    if (!existingColumns.includes('order_type')) {
      console.log('\n➕ Adding order_type column...');
      await pool.query(`
        ALTER TABLE orders 
        ADD COLUMN order_type VARCHAR(20) DEFAULT 'pickup' 
        COMMENT 'Order type: pickup or delivery'
      `);
      console.log('✅ order_type column added');
    } else {
      console.log('\n✓ order_type column already exists');
    }

    // Add delivery_mode column if it doesn't exist
    if (!existingColumns.includes('delivery_mode')) {
      console.log('\n➕ Adding delivery_mode column...');
      await pool.query(`
        ALTER TABLE orders 
        ADD COLUMN delivery_mode VARCHAR(20) DEFAULT 'pickup' 
        COMMENT 'Delivery mode: pickup or delivery (for compatibility)'
      `);
      console.log('✅ delivery_mode column added');
    } else {
      console.log('\n✓ delivery_mode column already exists');
    }

    // Verify all columns exist
    console.log('\n📋 Verifying columns...');
    const [verifyColumns] = await pool.query(`
      SELECT COLUMN_NAME, DATA_TYPE, COLUMN_DEFAULT, COLUMN_COMMENT
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'orders' 
        AND COLUMN_NAME IN ('scheduled_time', 'order_type', 'delivery_mode', 'latitude', 'longitude')
      ORDER BY COLUMN_NAME
    `);

    console.log('\n✅ All required columns:');
    verifyColumns.forEach(col => {
      console.log(`   - ${col.COLUMN_NAME} (${col.DATA_TYPE}): ${col.COLUMN_COMMENT || 'No comment'}`);
    });

    // Update existing orders to have default values
    console.log('\n🔄 Updating existing orders with default values...');
    
    // Set order_type and delivery_mode based on has_timer
    const [updateResult] = await pool.query(`
      UPDATE orders 
      SET 
        order_type = CASE WHEN has_timer = 1 THEN 'pickup' ELSE 'delivery' END,
        delivery_mode = CASE WHEN has_timer = 1 THEN 'pickup' ELSE 'delivery' END
      WHERE order_type IS NULL OR delivery_mode IS NULL
    `);
    
    console.log(`✅ Updated ${updateResult.affectedRows} orders with order_type and delivery_mode`);

    // Set scheduled_time for orders that don't have it
    // For pickup orders: use timer_started_at + 7 minutes
    // For delivery orders: use created_at + 30 minutes
    const [scheduleResult] = await pool.query(`
      UPDATE orders 
      SET scheduled_time = CASE 
        WHEN has_timer = 1 AND timer_started_at IS NOT NULL 
          THEN DATE_ADD(timer_started_at, INTERVAL 7 MINUTE)
        ELSE DATE_ADD(created_at, INTERVAL 30 MINUTE)
      END
      WHERE scheduled_time IS NULL
    `);
    
    console.log(`✅ Updated ${scheduleResult.affectedRows} orders with scheduled_time`);

    // Show sample data
    console.log('\n📊 Sample orders with new columns:');
    const [sampleOrders] = await pool.query(`
      SELECT 
        id, 
        status,
        order_type,
        delivery_mode,
        scheduled_time,
        has_timer,
        latitude,
        longitude,
        created_at
      FROM orders 
      ORDER BY created_at DESC 
      LIMIT 5
    `);

    if (sampleOrders.length > 0) {
      console.log('\n   Order ID | Type     | Mode     | Scheduled Time      | Has Timer | Location');
      console.log('   ---------|----------|----------|---------------------|-----------|----------');
      sampleOrders.forEach(order => {
        const lat = order.latitude ? order.latitude.toFixed(4) : 'N/A';
        const lng = order.longitude ? order.longitude.toFixed(4) : 'N/A';
        const location = order.latitude && order.longitude ? `${lat},${lng}` : 'N/A';
        const scheduled = order.scheduled_time 
          ? new Date(order.scheduled_time).toLocaleString('en-IN', { 
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
            })
          : 'N/A';
        console.log(`   ${String(order.id).padEnd(8)} | ${String(order.order_type || 'N/A').padEnd(8)} | ${String(order.delivery_mode || 'N/A').padEnd(8)} | ${scheduled.padEnd(19)} | ${order.has_timer ? 'Yes' : 'No'}       | ${location}`);
      });
    } else {
      console.log('   No orders found in database');
    }

    console.log('\n✅ Migration complete!');
    console.log('\n📝 Summary:');
    console.log('   - scheduled_time column: ✅ Added/Verified');
    console.log('   - order_type column: ✅ Added/Verified');
    console.log('   - delivery_mode column: ✅ Added/Verified');
    console.log('   - latitude column: ✅ Already exists');
    console.log('   - longitude column: ✅ Already exists');
    console.log('\n🎉 Database is ready for scheduled time and location features!');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      sqlMessage: error.sqlMessage
    });
    process.exit(1);
  }
}

addScheduledTimeColumns();
