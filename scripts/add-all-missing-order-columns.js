#!/usr/bin/env node

/**
 * Add all missing columns to orders table
 * 
 * This fixes multiple missing column errors:
 * - order_type
 * - scheduled_time
 * - delivery_mode (if needed)
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const COLUMNS_TO_ADD = [
  {
    name: 'order_type',
    definition: 'VARCHAR(50) DEFAULT "regular"',
    description: 'Type of order (regular, scheduled, etc.)'
  },
  {
    name: 'scheduled_time',
    definition: 'DATETIME NULL',
    description: 'Scheduled delivery time for future orders'
  },
  {
    name: 'delivery_mode',
    definition: 'VARCHAR(50) DEFAULT "delivery"',
    description: 'Delivery mode (delivery, pickup, etc.)'
  }
];

async function addMissingColumns() {
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
    
    // Get current table structure
    console.log('📋 Checking current orders table structure...');
    const [currentColumns] = await connection.query('DESCRIBE orders');
    const existingColumnNames = currentColumns.map(col => col.Field);
    
    console.log(`Found ${existingColumnNames.length} existing columns\n`);
    
    // Check and add each missing column
    let addedCount = 0;
    let skippedCount = 0;
    
    for (const column of COLUMNS_TO_ADD) {
      if (existingColumnNames.includes(column.name)) {
        console.log(`⏭️  Skipping ${column.name} - already exists`);
        skippedCount++;
        continue;
      }
      
      console.log(`\n🔧 Adding column: ${column.name}`);
      console.log(`   Description: ${column.description}`);
      console.log(`   Definition: ${column.definition}`);
      
      try {
        await connection.query(`
          ALTER TABLE orders 
          ADD COLUMN ${column.name} ${column.definition}
        `);
        
        console.log(`✅ Successfully added ${column.name}`);
        addedCount++;
        
      } catch (error) {
        console.error(`❌ Failed to add ${column.name}:`, error.message);
      }
    }
    
    // Show final table structure
    console.log('\n📊 Final orders table structure:\n');
    const [finalStructure] = await connection.query('DESCRIBE orders');
    
    console.log('Column Name'.padEnd(30) + 'Type'.padEnd(25) + 'Default');
    console.log('-'.repeat(80));
    
    finalStructure.forEach(col => {
      const name = col.Field.padEnd(30);
      const type = col.Type.padEnd(25);
      const def = col.Default || 'NULL';
      console.log(`${name}${type}${def}`);
    });
    
    console.log('\n' + '='.repeat(80));
    console.log(`✅ Summary: Added ${addedCount} columns, Skipped ${skippedCount} columns`);
    console.log(`📊 Total columns: ${finalStructure.length}`);
    console.log('='.repeat(80));
    
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

console.log('🚀 Starting missing columns addition...\n');
addMissingColumns()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error.message);
    process.exit(1);
  });
