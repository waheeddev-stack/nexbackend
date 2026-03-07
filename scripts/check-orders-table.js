#!/usr/bin/env node

/**
 * Check orders table structure
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function checkOrdersTable() {
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
    
    console.log('✅ Connected to database\n');
    
    // Show orders table structure
    console.log('📊 Orders table structure:\n');
    const [structure] = await connection.query('DESCRIBE orders');
    
    console.log('Column Name'.padEnd(30) + 'Type'.padEnd(20) + 'Null'.padEnd(10) + 'Default');
    console.log('-'.repeat(80));
    
    structure.forEach(col => {
      const name = col.Field.padEnd(30);
      const type = col.Type.padEnd(20);
      const nullable = (col.Null === 'YES' ? 'YES' : 'NO').padEnd(10);
      const def = col.Default || 'NULL';
      console.log(`${name}${type}${nullable}${def}`);
    });
    
    console.log('\n✅ Total columns:', structure.length);
    
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

checkOrdersTable()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  });
