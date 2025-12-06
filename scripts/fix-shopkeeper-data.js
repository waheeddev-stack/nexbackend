#!/usr/bin/env node

import pool from '../config/db.js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

async function fixShopkeeperData() {
  console.log('🔧 Fixing Shopkeeper Data...\n');

  try {
    // First, check the shopkeeper table structure
    console.log('1. 🔍 Checking shopkeeper table structure...');
    const [tableInfo] = await pool.query('DESCRIBE shopkeepers');
    console.log('   📋 Table columns:');
    tableInfo.forEach(col => {
      console.log(`      - ${col.Field}: ${col.Type} ${col.Null === 'NO' ? '(NOT NULL)' : ''} ${col.Key === 'PRI' ? '(PRIMARY KEY)' : ''}`);
    });

    // Check existing shopkeepers
    console.log('\n2. 🔍 Checking existing shopkeepers...');
    const [existingShopkeepers] = await pool.query('SELECT * FROM shopkeepers LIMIT 5');
    console.log(`   📊 Found ${existingShopkeepers.length} shopkeepers`);
    
    if (existingShopkeepers.length > 0) {
      existingShopkeepers.forEach((shop, index) => {
        console.log(`   ${index + 1}. ID: ${shop.id}, Email: ${shop.email}, Verified: ${shop.is_verified}`);
      });
    }

    // Delete existing test shopkeeper if exists
    console.log('\n3. 🗑️ Cleaning up existing test shopkeeper...');
    const [deleteResult] = await pool.query('DELETE FROM shopkeepers WHERE email = ?', ['test@shopkeeper.com']);
    console.log(`   ✅ Deleted ${deleteResult.affectedRows} existing test shopkeeper(s)`);

    // Create new test shopkeeper with proper data
    console.log('\n4. 👤 Creating new test shopkeeper...');
    const hashedPassword = await bcrypt.hash('test123', 10);
    
    const [insertResult] = await pool.query(`
      INSERT INTO shopkeepers (name, email, password, phone, address, shop_name, is_verified, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      'Test Shopkeeper',
      'test@shopkeeper.com', 
      hashedPassword,
      '9876543210',
      'Test Address, Test City',
      'Test Shop',
      1  // Verified
    ]);

    console.log(`   ✅ Created shopkeeper with ID: ${insertResult.insertId}`);

    // Verify the creation
    console.log('\n5. ✅ Verifying new shopkeeper...');
    const [newShopkeeper] = await pool.query('SELECT * FROM shopkeepers WHERE email = ?', ['test@shopkeeper.com']);
    
    if (newShopkeeper.length > 0) {
      const shop = newShopkeeper[0];
      console.log(`   ✅ ID: ${shop.id}`);
      console.log(`   ✅ Name: ${shop.name}`);
      console.log(`   ✅ Email: ${shop.email}`);
      console.log(`   ✅ Shop: ${shop.shop_name}`);
      console.log(`   ✅ Phone: ${shop.phone}`);
      console.log(`   ✅ Verified: ${shop.is_verified ? 'Yes' : 'No'}`);
      console.log(`   ✅ Created: ${shop.created_at}`);
    }

    // Also ensure test user exists
    console.log('\n6. 👤 Checking test user...');
    const [existingUser] = await pool.query('SELECT * FROM users WHERE email = ?', ['test@user.com']);
    
    if (existingUser.length === 0) {
      console.log('   🔧 Creating test user...');
      const userHashedPassword = await bcrypt.hash('test123', 10);
      
      const [userResult] = await pool.query(`
        INSERT INTO users (name, email, password, phone, address, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())
      `, [
        'Test User',
        'test@user.com',
        userHashedPassword,
        '9876543211',
        'Test User Address, Test City'
      ]);
      
      console.log(`   ✅ Created user with ID: ${userResult.insertId}`);
    } else {
      console.log(`   ✅ Test user already exists (ID: ${existingUser[0].id})`);
    }

    console.log('\n🎉 Shopkeeper data fix completed successfully!');
    console.log('\n📝 Test Credentials:');
    console.log('   Shopkeeper: test@shopkeeper.com / test123');
    console.log('   User: test@user.com / test123');
    console.log('\n🧪 Next Steps:');
    console.log('   1. Run: npm run quick-test');
    console.log('   2. Run: npm run test-comprehensive');

  } catch (error) {
    console.error('❌ Fix failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

fixShopkeeperData();