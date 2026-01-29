import pool from '../config/db.js';
import { createStockRestorationLogTable } from '../utils/stockManager.js';

/**
 * Initialize the stock restoration log table
 * This script creates the table needed to track stock restoration events
 */
async function initStockRestorationTable() {
  try {
    console.log('🗄️ Initializing stock restoration log table...');
    
    await createStockRestorationLogTable();
    
    console.log('✅ Stock restoration log table initialization completed');
    
    // Test the table by checking its structure
    const [tableInfo] = await pool.query(`
      DESCRIBE stock_restoration_log
    `);
    
    console.log('\n📋 Table structure:');
    tableInfo.forEach(column => {
      console.log(`  - ${column.Field}: ${column.Type} ${column.Null === 'NO' ? 'NOT NULL' : 'NULL'} ${column.Key ? `(${column.Key})` : ''}`);
    });
    
    // Check if there are any existing records
    const [[count]] = await pool.query(`
      SELECT COUNT(*) as total FROM stock_restoration_log
    `);
    
    console.log(`\n📊 Current records in stock_restoration_log: ${count.total}`);
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error initializing stock restoration table:', error);
    process.exit(1);
  }
}

// Run the initialization
initStockRestorationTable();