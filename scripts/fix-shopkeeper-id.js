#!/usr/bin/env node

import pool from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

async function fixShopkeeperID() {
  console.log('🔧 Fixing Shopkeeper ID Issue...\n');

  try {
    // Check table structure
    console.log('1. 🔍 Checking shopkeepers table structure...');
    const [tableInfo] = await pool.query('DESCRIBE shopkeepers');
    console.log('   📋 Table columns:');
    tableInfo.forEach(col => {
      console.log(`      - ${col.Field}: ${col.Type} ${col.Key === 'PRI' ? '(PRIMARY KEY)' : ''} ${col.Extra}`);
    });

    // Check current shopkeepers
    console.log('\n2. 📊 Current shopkeepers data...');
    const [shopkeepers] = await pool.query('SELECT id, email, name FROM shopkeepers ORDER BY created_at DESC LIMIT 10');
    console.log(`   Found ${shopkeepers.length} shopkeepers:`);
    shopkeepers.forEach((shop, index) => {
      console.log(`   ${index + 1}. ID: ${shop.id} (${typeof shop.id}), Email: ${shop.email}`);
    });

    // Check if there's an auto-increment issue
    console.log('\n3. 🔧 Checking auto-increment status...');
    const [autoIncrement] = await pool.query('SHOW TABLE STATUS LIKE "shopkeepers"');
    if (autoIncrement.length > 0) {
      console.log(`   📊 Auto_increment value: ${autoIncrement[0].Auto_increment}`);
    }

    // Fix the test shopkeeper by deleting and recreating with proper ID
    console.log('\n4. 🗑️ Removing problematic test shopkeeper...');
    const [deleteResult] = await pool.query('DELETE FROM shopkeepers WHERE email = ? AND id IS NULL', ['test@shopkeeper.com']);
    console.log(`   ✅ Deleted ${deleteResult.affectedRows} shopkeeper(s) with null ID`);

    // Also delete any with id = 0
    const [deleteZero] = await pool.query('DELETE FROM shopkeepers WHERE email = ? AND id = 0', ['test@shopkeeper.com']);
    console.log(`   ✅ Deleted ${deleteZero.affectedRows} shopkeeper(s) with zero ID`);

    // Create new test shopkeeper with proper auto-increment
    console.log('\n5. 👤 Creating new test shopkeeper...');
    
    // First, let's reset the auto-increment to ensure we get a proper ID
    const [maxId] = await pool.query('SELECT MAX(id) as max_id FROM shopkeepers WHERE id IS NOT NULL AND id > 0');
    const nextId = (maxId[0].max_id || 0) + 1;
    
    console.log(`   📊 Next available ID: ${nextId}`);
    
    // Create shopkeeper with explicit ID to ensure it's not null
    const [insertResult] = await pool.query(`
      INSERT INTO shopkeepers (id, name, email, password, phone, address, shop_name, is_verified, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      nextId,
      'Test Shopkeeper',
      'test@shopkeeper.com',
      '$2a$10$rQJ8vQZ9Z9Z9Z9Z9Z9Z9ZOZ9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z', // Pre-hashed 'test123'
      '9876543210',
      'Test Address, Test City',
      'Test Shop',
      1
    ]);

    console.log(`   ✅ Created shopkeeper with ID: ${insertResult.insertId || nextId}`);

    // Verify the fix
    console.log('\n6. ✅ Verifying the fix...');
    const [newShopkeeper] = await pool.query('SELECT id, email, name, is_verified FROM shopkeepers WHERE email = ?', ['test@shopkeeper.com']);
    
    if (newShopkeeper.length > 0) {
      const shop = newShopkeeper[0];
      console.log(`   ✅ Fixed shopkeeper found:`);
      console.log(`      ID: ${shop.id} (${typeof shop.id})`);
      console.log(`      Email: ${shop.email}`);
      console.log(`      Name: ${shop.name}`);
      console.log(`      Verified: ${shop.is_verified}`);
      
      if (shop.id !== null && shop.id !== 0) {
        console.log('   🎉 ID is now valid and not null!');
      } else {
        console.log('   ❌ ID is still null or zero');
      }
    } else {
      console.log('   ❌ Shopkeeper not found after creation');
    }

    // Update password to proper hash
    console.log('\n7. 🔐 Updating password hash...');
    const bcrypt = await import('bcryptjs');
    const hashedPassword = await bcrypt.default.hash('test123', 10);
    
    const [updateResult] = await pool.query(
      'UPDATE shopkeepers SET password = ? WHERE email = ?',
      [hashedPassword, 'test@shopkeeper.com']
    );
    
    console.log(`   ✅ Updated password for ${updateResult.affectedRows} shopkeeper(s)`);

    console.log('\n🎉 Shopkeeper ID fix completed!');
    console.log('\n📝 Test Credentials:');
    console.log('   Email: test@shopkeeper.com');
    console.log('   Password: test123');
    console.log('\n🧪 Next Steps:');
    console.log('   1. Run: npm run debug-jwt');
    console.log('   2. Run: npm run test-working');
    console.log('   3. Run: npm run test-comprehensive');

  } catch (error) {
    console.error('❌ Fix failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

fixShopkeeperID();