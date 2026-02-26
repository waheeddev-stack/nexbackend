/**
 * Initialize Inventory Integration
 * 
 * This script initializes the inventory management integration by:
 * 1. Creating necessary database tables (if they don't exist)
 * 2. Testing the database connection
 * 3. Verifying the integration is working
 * 
 * CRITICAL: Only creates NEW tables, does NOT modify existing schema.
 */

import pool from '../config/db.js';
import { initializeInventoryDB, closeInventoryDB } from '../config/inventory.db.bridge.js';

async function initInventoryIntegration() {
  console.log('🚀 Starting inventory integration initialization...\n');
  
  let connection;
  
  try {
    // Step 1: Test main database connection
    console.log('1️⃣ Testing main database connection...');
    connection = await pool.getConnection();
    console.log('✅ Main database connected\n');
    
    // Step 2: Create inventory_products table if it doesn't exist
    console.log('2️⃣ Creating inventory_products table (if not exists)...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS inventory_products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        stock INT DEFAULT 0,
        baselineQty INT DEFAULT 0,
        restockAt DATETIME NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_stock (stock),
        INDEX idx_restock (restockAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ inventory_products table ready\n');
    
    // Step 3: Verify stock_restoration_log table exists
    console.log('3️⃣ Verifying stock_restoration_log table...');
    const [tables] = await connection.execute(`
      SHOW TABLES LIKE 'stock_restoration_log'
    `);
    
    if (tables.length === 0) {
      console.log('⚠️ stock_restoration_log table not found, creating...');
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS stock_restoration_log (
          id INT AUTO_INCREMENT PRIMARY KEY,
          order_id INT NOT NULL,
          action VARCHAR(50) NOT NULL,
          reason VARCHAR(100) NULL,
          details TEXT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_order_id (order_id),
          INDEX idx_action (action)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✅ stock_restoration_log table created');
    } else {
      console.log('✅ stock_restoration_log table exists');
    }
    console.log();
    
    connection.release();
    
    // Step 4: Initialize Sequelize bridge
    console.log('4️⃣ Initializing Sequelize bridge...');
    const { sequelize, models } = await initializeInventoryDB();
    console.log('✅ Sequelize bridge initialized\n');
    
    // Step 5: Test Sequelize models
    console.log('5️⃣ Testing Sequelize models...');
    const count = await models.InventoryProduct.count();
    console.log(`✅ Found ${count} inventory products\n`);
    
    // Step 6: Display integration status
    console.log('6️⃣ Integration Status:');
    console.log('   ✅ Database connection: OK');
    console.log('   ✅ inventory_products table: OK');
    console.log('   ✅ stock_restoration_log table: OK');
    console.log('   ✅ Sequelize bridge: OK');
    console.log('   ✅ Models loaded: OK\n');
    
    console.log('🎉 Inventory integration initialized successfully!\n');
    console.log('📋 Next steps:');
    console.log('   1. Start the server: npm start');
    console.log('   2. Test inventory endpoints: /api/inventory-mgmt/*');
    console.log('   3. Verify cron job is running (check logs)\n');
    
    await closeInventoryDB();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Initialization failed:', error);
    
    if (connection) {
      connection.release();
    }
    
    await closeInventoryDB();
    process.exit(1);
  }
}

// Run initialization
initInventoryIntegration();
