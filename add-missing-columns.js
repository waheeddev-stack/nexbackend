/**
 * Add Missing Columns
 * Adds the restockAt and is_deleted columns that were missing
 */

import pool from './config/db.js';

async function addMissingColumns() {
  console.log('🔧 Adding missing columns...\n');
  
  try {
    // Add restockAt column to products
    console.log('Adding restockAt column to products table...');
    try {
      await pool.execute(`
        ALTER TABLE products 
        ADD COLUMN restockAt DATETIME NULL 
        COMMENT 'Scheduled restock time for out-of-stock products'
      `);
      console.log('✅ restockAt column added to products\n');
    } catch (error) {
      if (error.message.includes('Duplicate column')) {
        console.log('⏭️  restockAt column already exists\n');
      } else {
        throw error;
      }
    }
    
    // Add is_deleted column to users
    console.log('Adding is_deleted column to users table...');
    try {
      await pool.execute(`
        ALTER TABLE users 
        ADD COLUMN is_deleted TINYINT(1) DEFAULT 0 
        COMMENT 'Soft delete flag for users'
      `);
      console.log('✅ is_deleted column added to users\n');
    } catch (error) {
      if (error.message.includes('Duplicate column')) {
        console.log('⏭️  is_deleted column already exists\n');
      } else {
        throw error;
      }
    }
    
    // Create indexes for the new columns
    console.log('Creating indexes for new columns...');
    try {
      await pool.execute('CREATE INDEX idx_products_restock ON products(restockAt)');
      console.log('✅ Index created on products.restockAt');
    } catch (error) {
      if (error.message.includes('Duplicate key')) {
        console.log('⏭️  Index on products.restockAt already exists');
      } else {
        console.log('⚠️  Could not create index on products.restockAt:', error.message);
      }
    }
    
    try {
      await pool.execute('CREATE INDEX idx_users_deleted ON users(is_deleted)');
      console.log('✅ Index created on users.is_deleted');
    } catch (error) {
      if (error.message.includes('Duplicate key')) {
        console.log('⏭️  Index on users.is_deleted already exists');
      } else {
        console.log('⚠️  Could not create index on users.is_deleted:', error.message);
      }
    }
    
    console.log('\n🎉 All missing columns added successfully!');
    console.log('✨ Database optimization is now complete!\n');
    
  } catch (error) {
    console.error('❌ Error adding columns:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

addMissingColumns();
