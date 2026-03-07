import pool from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Add Address Detail Fields to Users Table
 * 
 * This script adds the following columns to the users table:
 * - area: VARCHAR(255) - Area/locality
 * - landmark: VARCHAR(255) - Nearby landmark
 * - pincode: VARCHAR(10) - Postal code
 */

async function addUserAddressFields() {
  try {
    console.log('🔧 Adding address detail fields to users table...\n');

    // Check if columns already exist
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'users' 
        AND COLUMN_NAME IN ('area', 'landmark', 'pincode')
    `);

    const existingColumns = columns.map(col => col.COLUMN_NAME);
    console.log('📊 Existing address columns:', existingColumns.length > 0 ? existingColumns.join(', ') : 'None');

    // Add area column if it doesn't exist
    if (!existingColumns.includes('area')) {
      console.log('\n➕ Adding area column...');
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN area VARCHAR(255) DEFAULT NULL 
        COMMENT 'Area or locality'
      `);
      console.log('✅ area column added');
    } else {
      console.log('\n✓ area column already exists');
    }

    // Add landmark column if it doesn't exist
    if (!existingColumns.includes('landmark')) {
      console.log('\n➕ Adding landmark column...');
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN landmark VARCHAR(255) DEFAULT NULL 
        COMMENT 'Nearby landmark'
      `);
      console.log('✅ landmark column added');
    } else {
      console.log('\n✓ landmark column already exists');
    }

    // Add pincode column if it doesn't exist
    if (!existingColumns.includes('pincode')) {
      console.log('\n➕ Adding pincode column...');
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN pincode VARCHAR(10) DEFAULT NULL 
        COMMENT 'Postal code'
      `);
      console.log('✅ pincode column added');
    } else {
      console.log('\n✓ pincode column already exists');
    }

    // Verify all columns exist
    console.log('\n📋 Verifying columns...');
    const [verifyColumns] = await pool.query(`
      SELECT COLUMN_NAME, DATA_TYPE, COLUMN_DEFAULT, COLUMN_COMMENT
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'users' 
        AND COLUMN_NAME IN ('address', 'area', 'landmark', 'pincode')
      ORDER BY COLUMN_NAME
    `);

    console.log('\n✅ All address-related columns:');
    verifyColumns.forEach(col => {
      console.log(`   - ${col.COLUMN_NAME} (${col.DATA_TYPE}): ${col.COLUMN_COMMENT || 'No comment'}`);
    });

    // Show sample data
    console.log('\n📊 Sample users with address fields:');
    const [sampleUsers] = await pool.query(`
      SELECT 
        id, 
        name,
        email,
        address,
        area,
        landmark,
        pincode
      FROM users 
      ORDER BY created_at DESC 
      LIMIT 5
    `);

    if (sampleUsers.length > 0) {
      console.log('\n   ID  | Name           | Email                  | Has Address | Has Area | Has Landmark | Has Pincode');
      console.log('   ----|----------------|------------------------|-------------|----------|--------------|------------');
      sampleUsers.forEach(user => {
        const id = String(user.id).padEnd(3);
        const name = (user.name || 'N/A').substring(0, 14).padEnd(14);
        const email = (user.email || 'N/A').substring(0, 22).padEnd(22);
        const hasAddr = user.address ? 'Yes' : 'No ';
        const hasArea = user.area ? 'Yes' : 'No ';
        const hasLandmark = user.landmark ? 'Yes' : 'No ';
        const hasPincode = user.pincode ? 'Yes' : 'No ';
        console.log(`   ${id} | ${name} | ${email} | ${hasAddr}         | ${hasArea}      | ${hasLandmark}          | ${hasPincode}`);
      });
    } else {
      console.log('   No users found in database');
    }

    console.log('\n✅ Migration complete!');
    console.log('\n📝 Summary:');
    console.log('   - address column: ✅ Already exists');
    console.log('   - area column: ✅ Added/Verified');
    console.log('   - landmark column: ✅ Added/Verified');
    console.log('   - pincode column: ✅ Added/Verified');
    console.log('\n🎉 Users table is ready for detailed address information!');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      sqlMessage: error.sqlMessage
    });
    process.exit(1);
  }
}

addUserAddressFields();
