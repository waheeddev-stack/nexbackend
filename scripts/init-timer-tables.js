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
    // Read the SQL schema file
    const schemaPath = path.join(__dirname, '../schema/order_timers.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Split by semicolon and execute each statement
    const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);

    for (const statement of statements) {
      const trimmedStatement = statement.trim();
      if (trimmedStatement) {
        console.log(`Executing: ${trimmedStatement.substring(0, 50)}...`);
        await pool.query(trimmedStatement);
      }
    }

    console.log('\n✅ Timer tables initialized successfully!');

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