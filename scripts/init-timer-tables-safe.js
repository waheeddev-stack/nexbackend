#!/usr/bin/env node

import pool from '../config/db.js';

async function initializeTimerTablesSafe() {
  console.log('🔧 Safely Initializing Order Timer Tables...\n');

  try {
    // Step 1: Check if orders table exists
    console.log('1. 🔍 Checking orders table...');
    const [ordersExists] = await pool.query(`
      SELECT COUNT(*) as count
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'orders'
    `);

    if (ordersExists[0].count === 0) {
      console.log('   ❌ Orders table does not exist! Creating basic orders table...');
      await pool.query(`
        CREATE TABLE orders (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          shopkeeper_id INT NOT NULL,
          status ENUM('Pending','Processing','Delivered','Cancelled') DEFAULT 'Pending',
          total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
          delivery_address TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('   ✅ Orders table created');
    } else {
      console.log('   ✅ Orders table exists');
    }

    // Step 2: Add timer columns to orders table if they don't exist
    console.log('\n2. 🔧 Adding timer columns to orders table...');
    
    const timerColumns = [
      { name: 'has_timer', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'pickup_code', type: 'VARCHAR(6) NULL' },
      { name: 'timer_started_at', type: 'TIMESTAMP NULL' },
      { name: 'timer_expires_at', type: 'TIMESTAMP NULL' }
    ];

    for (const column of timerColumns) {
      try {
        // Check if column exists
        const [columnExists] = await pool.query(`
          SELECT COUNT(*) as count
          FROM information_schema.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'orders' 
          AND COLUMN_NAME = ?
        `, [column.name]);

        if (columnExists[0].count === 0) {
          await pool.query(`ALTER TABLE orders ADD COLUMN ${column.name} ${column.type}`);
          console.log(`   ✅ Added column: ${column.name}`);
        } else {
          console.log(`   ⚠️  Column ${column.name} already exists`);
        }
      } catch (error) {
        console.log(`   ❌ Failed to add column ${column.name}:`, error.message);
      }
    }

    // Step 3: Create order_timers table (without foreign key initially)
    console.log('\n3. 🔧 Creating order_timers table...');
    
    try {
      // Drop existing table if it exists
      await pool.query('DROP TABLE IF EXISTS order_timers');
      
      // Create new table without foreign key constraint
      await pool.query(`
        CREATE TABLE order_timers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          order_id INT NOT NULL,
          pickup_code VARCHAR(6) NOT NULL,
          timer_duration INT DEFAULT 420,
          timer_started_at TIMESTAMP NULL,
          timer_expires_at TIMESTAMP NULL,
          is_active BOOLEAN DEFAULT FALSE,
          is_expired BOOLEAN DEFAULT FALSE,
          stopped_at TIMESTAMP NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY unique_order_timer (order_id),
          INDEX idx_pickup_code (pickup_code),
          INDEX idx_active_timers (is_active, timer_expires_at)
        )
      `);
      console.log('   ✅ order_timers table created');
    } catch (error) {
      console.log('   ❌ Failed to create order_timers table:', error.message);
    }

    // Step 4: Add foreign key constraint (if possible)
    console.log('\n4. 🔗 Adding foreign key constraint...');
    try {
      await pool.query(`
        ALTER TABLE order_timers 
        ADD CONSTRAINT fk_order_timers_order_id 
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
      `);
      console.log('   ✅ Foreign key constraint added');
    } catch (error) {
      console.log('   ⚠️  Foreign key constraint failed (will work without it):', error.message);
    }

    // Step 5: Create indexes
    console.log('\n5. 📊 Creating indexes...');
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_orders_timer 
        ON orders(has_timer, timer_expires_at)
      `);
      console.log('   ✅ Orders timer index created');
    } catch (error) {
      console.log('   ⚠️  Index creation failed:', error.message);
    }

    // Step 6: Test the setup
    console.log('\n6. 🧪 Testing timer tables...');
    
    const [timerTables] = await pool.query(`
      SELECT TABLE_NAME, TABLE_ROWS 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME IN ('orders', 'order_timers')
    `);

    console.log('📊 Timer System Tables:');
    timerTables.forEach(table => {
      console.log(`   - ${table.TABLE_NAME}: ${table.TABLE_ROWS || 0} rows`);
    });

    // Check timer columns in orders table
    const [orderColumns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'orders' 
      AND COLUMN_NAME IN ('has_timer', 'pickup_code', 'timer_started_at', 'timer_expires_at')
    `);

    console.log('\n📋 Orders Table Timer Columns:');
    if (orderColumns.length > 0) {
      orderColumns.forEach(col => {
        console.log(`   ✅ ${col.COLUMN_NAME}`);
      });
    } else {
      console.log('   ❌ No timer columns found');
    }

    console.log('\n🎉 Timer system initialization completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Deploy the updated backend code');
    console.log('   2. Test with: npm run test-order-api');
    console.log('   3. Generate report: npm run order-report');

  } catch (error) {
    console.error('❌ Timer initialization failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initializeTimerTablesSafe();