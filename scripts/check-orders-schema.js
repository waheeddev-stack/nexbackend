#!/usr/bin/env node

import pool from '../config/db.js';

async function checkOrdersSchema() {
  console.log('🔍 Checking existing orders table schema...\n');

  try {
    // Check if orders table exists and get its structure
    const [tableExists] = await pool.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'orders'
    `);

    if (tableExists.length === 0) {
      console.log('❌ Orders table does not exist!');
      return;
    }

    console.log('✅ Orders table exists');

    // Get column information
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'orders'
      ORDER BY ORDINAL_POSITION
    `);

    console.log('\n📋 Orders table structure:');
    columns.forEach(col => {
      console.log(`   - ${col.COLUMN_NAME}: ${col.DATA_TYPE} ${col.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL'} ${col.EXTRA || ''}`);
    });

    // Check specifically for the id column
    const idColumn = columns.find(col => col.COLUMN_NAME === 'id');
    if (idColumn) {
      console.log(`\n🎯 ID column details:`);
      console.log(`   - Type: ${idColumn.DATA_TYPE}`);
      console.log(`   - Extra: ${idColumn.EXTRA || 'none'}`);
    }

    // Check existing data
    const [orderCount] = await pool.query('SELECT COUNT(*) as count FROM orders');
    console.log(`\n📊 Existing orders: ${orderCount[0].count}`);

    if (orderCount[0].count > 0) {
      const [sampleOrders] = await pool.query('SELECT id, status, created_at FROM orders LIMIT 3');
      console.log('\n📋 Sample orders:');
      sampleOrders.forEach(order => {
        console.log(`   - ID: ${order.id} (${typeof order.id}), Status: ${order.status}`);
      });
    }

  } catch (error) {
    console.error('❌ Schema check failed:', error.message);
  } finally {
    await pool.end();
  }
}

checkOrdersSchema();