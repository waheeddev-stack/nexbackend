#!/usr/bin/env node

/**
 * Add missing order_type column to orders table
 * 
 * This fixes the error: Unknown column 'order_type' in 'field list'
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function addOrderTypeColumn() {
  let connection;
  
  try {
    console.log('🔌 Connecting to database...');
    
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
      ssl: process.env.DB_HOST?.includes('tidbcloud.com') ? {
        rejectUnauthorized: true
      } : undefined
    });
    
    console.log('✅ Connected to database');
    
    // Check if column already exists
    console.log('\n📋 Checking if order_type column exists...');
    const [columns] = await connection.query(
      `SHOW COLUMNS FROM orders LIKE 'order_type'`
    );
    
    if (columns.length > 0) {
      console.log('ℹ️  order_type column already exists');
      console.log('Column details:', columns[0]);
      return;
    }
    
    console.log('❌ order_type column does not exist');
    console.log('\n🔧 Adding order_type column...');
    
    // Add the column at the end of the table
    await connection.query(`
      ALTER TABLE orders 
      ADD COLUMN order_type VARCHAR(50) DEFAULT 'regular'
    `);
    
    console.log('✅ order_type column added successfully');
    
    // Verify the column was added
    console.log('\n🔍 Verifying column was added...');
    const [newColumns] = await connection.query(
      `SHOW COLUMNS FROM orders LIKE 'order_type'`
    );
    
    if (newColumns.length > 0) {
      console.log('✅ Verification successful');
      console.log('Column details:', newColumns[0]);
    } else {
      console.log('❌ Verification failed - column not found');
    }
    
    // Show orders table structure
    console.log('\n📊 Current orders table structure:');
    const [structure] = await connection.query('DESCRIBE orders');
    structure.forEach(col => {
      console.log(`  ${col.Field} (${col.Type}) ${col.Null === 'YES' ? 'NULL' : 'NOT NULL'} ${col.Default ? `DEFAULT ${col.Default}` : ''}`);
    });
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.code) {
      console.error('Error code:', error.code);
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Database connection closed');
    }
  }
}

// Run the script
console.log('🚀 Starting order_type column addition...\n');
addOrderTypeColumn()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error.message);
    process.exit(1);
  });
