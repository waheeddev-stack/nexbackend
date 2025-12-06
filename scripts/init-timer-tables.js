#!/usr/bin/env node

import pool from '../config/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function initializeTimerTables() {
  console.log('🔧 Initializing Order Timer Tables...\n');

  try {
    // First check existing orders table structure
    console.log('1. 🔍 Checking existing orders table...');
    
    const [ordersTable] = await pool.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'orders'
    `);

    if (ordersTable.length === 0) {
      console.log('   ⚠️  Orders table does not exist, creating it...');
    } else {
      console.log('   ✅ Orders table exists');
    }

    // Get the ID column type from orders table
    const [idColumn] = await pool.query(`
      SELECT DATA_TYPE, COLUMN_TYPE
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'orders' 
      AND COLUMN_NAME = 'id'
    `);

    let idType = 'INT';
    if (idColumn.length > 0) {
      idType = idColumn[0].COLUMN_TYPE || 'INT';
      console.log(`   📋 Orders.id column type: ${idType}`);
    }

    console.log('\n2. 🔧 Creating/updating timer tables...');
    console.log('   📋 Creating order_timers table with columns:');
    console.log('      - pickup_code (6-digit verification code)');
    console.log('      - timer_duration (default 420 seconds = 7 minutes)');
    console.log('      - timer_started_at (when timer begins)');
    console.log('      - timer_expires_at (when timer ends)');

    // Execute schema statements one by one with better error handling
    const schemaPath = path.join(__dirname, '../schema/order_timers.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Split by semicolon and filter out empty statements
    const statements = schema
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      try {
        console.log(`   Executing statement ${i + 1}/${statements.length}...`);
        await pool.query(statement);
        console.log(`   ✅ Statement ${i + 1} completed`);
      } catch (error) {
        if (error.message.includes('already exists') || 
            error.message.includes('Duplicate column name') ||
            error.message.includes('Duplicate key name')) {
          console.log(`   ⚠️  Statement ${i + 1} skipped (already exists)`);
        } else {
          console.error(`   ❌ Statement ${i + 1} failed:`, error.message);
          // Continue with other statements
        }
      }
    }

    console.log('\n✅ Timer tables initialization completed!');

    // Test the tables
    console.log('\n🧪 Testing timer tables...');
    
    const [timerTables] = await pool.query(`
      SELECT TABLE_NAME, TABLE_ROWS 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME IN ('order_timers')
    `);

    console.log('📊 Timer Tables Status:');
    timerTables.forEach(table => {
      console.log(`   - ${table.TABLE_NAME}: ${table.TABLE_ROWS || 0} rows`);
    });

    // Check if orders table has new columns
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
      console.log('   ⚠️  No timer columns found in orders table');
    }

    console.log('\n🎉 Timer system initialization completed!');

  } catch (error) {
    console.error('❌ Timer initialization failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initializeTimerTables();