import pool from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Cleanup Users Table and Enable Auto-Increment
 * 
 * This script:
 * 1. Deletes users with NULL or invalid IDs
 * 2. Enables AUTO_INCREMENT on the id column
 * 3. Resets AUTO_INCREMENT to next available ID
 */

async function cleanupUsersAndEnableAutoIncrement() {
  try {
    console.log('🔧 Starting users table cleanup and auto-increment setup...\n');

    // Step 1: Show current state
    console.log('📊 Current state of users table:');
    const [allUsers] = await pool.query('SELECT COUNT(*) as total FROM users');
    const [nullUsers] = await pool.query('SELECT COUNT(*) as total FROM users WHERE id IS NULL');
    const [validUsers] = await pool.query('SELECT COUNT(*) as total FROM users WHERE id IS NOT NULL');
    
    console.log(`   Total users: ${allUsers[0].total}`);
    console.log(`   Valid users (with ID): ${validUsers[0].total}`);
    console.log(`   Invalid users (NULL ID): ${nullUsers[0].total}\n`);

    // Step 2: Show users that will be deleted
    if (nullUsers[0].total > 0) {
      console.log('⚠️  Users with NULL IDs that will be DELETED:');
      const [usersToDelete] = await pool.query(
        'SELECT name, email, phone, created_at FROM users WHERE id IS NULL ORDER BY created_at'
      );
      
      console.log('\nName                | Email                           | Phone      | Created');
      console.log('--------------------|--------------------------------|------------|-------------------');
      usersToDelete.forEach(user => {
        const name = (user.name || 'N/A').substring(0, 19).padEnd(19);
        const email = (user.email || 'N/A').substring(0, 30).padEnd(30);
        const phone = (user.phone || 'N/A').substring(0, 10).padEnd(10);
        const created = user.created_at ? new Date(user.created_at).toISOString().substring(0, 19) : 'N/A';
        console.log(`${name} | ${email} | ${phone} | ${created}`);
      });
      
      console.log(`\n❌ ${nullUsers[0].total} users will be DELETED\n`);
    }

    // Step 3: Delete users with NULL IDs
    if (nullUsers[0].total > 0) {
      console.log('🗑️  Deleting users with NULL IDs...');
      const [deleteResult] = await pool.query('DELETE FROM users WHERE id IS NULL');
      console.log(`✅ Deleted ${deleteResult.affectedRows} users with NULL IDs\n`);
    } else {
      console.log('✅ No users with NULL IDs to delete\n');
    }

    // Step 4: Check for duplicate IDs
    console.log('🔍 Checking for duplicate IDs...');
    const [duplicates] = await pool.query(`
      SELECT id, COUNT(*) as count 
      FROM users 
      WHERE id IS NOT NULL 
      GROUP BY id 
      HAVING count > 1
    `);
    
    if (duplicates.length > 0) {
      console.log(`⚠️  Found ${duplicates.length} duplicate IDs:`);
      duplicates.forEach(dup => {
        console.log(`   ID ${dup.id}: ${dup.count} users`);
      });
      console.log('\n❌ Cannot enable auto-increment with duplicate IDs!');
      console.log('Please manually resolve duplicate IDs first.\n');
      process.exit(1);
    } else {
      console.log('✅ No duplicate IDs found\n');
    }

    // Step 5: Get current max ID
    const [maxIdResult] = await pool.query('SELECT MAX(id) as maxId FROM users WHERE id IS NOT NULL');
    const maxId = maxIdResult[0].maxId || 0;
    console.log(`📊 Current maximum ID: ${maxId}\n`);

    // Step 6: Check current table structure
    console.log('🔍 Checking current table structure...');
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_KEY, EXTRA 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'users' 
        AND COLUMN_NAME = 'id'
    `);
    
    if (columns.length > 0) {
      const idColumn = columns[0];
      console.log(`   Column: ${idColumn.COLUMN_NAME}`);
      console.log(`   Type: ${idColumn.COLUMN_TYPE}`);
      console.log(`   Key: ${idColumn.COLUMN_KEY}`);
      console.log(`   Extra: ${idColumn.EXTRA || 'None'}\n`);
      
      if (idColumn.EXTRA && idColumn.EXTRA.includes('auto_increment')) {
        console.log('✅ AUTO_INCREMENT is already enabled\n');
      } else {
        console.log('⚠️  AUTO_INCREMENT is NOT enabled\n');
      }
    }

    // Step 7: Modify id column to add AUTO_INCREMENT
    console.log('🔧 Modifying id column to enable AUTO_INCREMENT...');
    try {
      // First, ensure id is PRIMARY KEY and NOT NULL
      await pool.query(`
        ALTER TABLE users 
        MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT,
        ADD PRIMARY KEY (id)
      `);
      console.log('✅ AUTO_INCREMENT enabled on id column\n');
    } catch (error) {
      if (error.code === 'ER_MULTIPLE_PRI_KEY' || error.message.includes('Multiple primary key')) {
        // Primary key already exists, just modify the column
        console.log('   Primary key already exists, modifying column...');
        await pool.query(`
          ALTER TABLE users 
          MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT
        `);
        console.log('✅ AUTO_INCREMENT enabled on id column\n');
      } else {
        throw error;
      }
    }

    // Step 8: Set AUTO_INCREMENT to next available ID
    const nextId = maxId + 1;
    console.log(`🔧 Setting AUTO_INCREMENT to ${nextId}...`);
    await pool.query(`ALTER TABLE users AUTO_INCREMENT = ${nextId}`);
    console.log(`✅ AUTO_INCREMENT set to ${nextId}\n`);

    // Step 9: Verify the changes
    console.log('📋 Verifying changes...');
    const [verifyColumns] = await pool.query(`
      SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_KEY, EXTRA 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'users' 
        AND COLUMN_NAME = 'id'
    `);
    
    if (verifyColumns.length > 0) {
      const col = verifyColumns[0];
      console.log(`   Column: ${col.COLUMN_NAME}`);
      console.log(`   Type: ${col.COLUMN_TYPE}`);
      console.log(`   Key: ${col.COLUMN_KEY}`);
      console.log(`   Extra: ${col.EXTRA}\n`);
    }

    // Step 10: Show final state
    console.log('📊 Final state of users table:');
    const [finalUsers] = await pool.query('SELECT COUNT(*) as total FROM users');
    const [finalValid] = await pool.query('SELECT COUNT(*) as total FROM users WHERE id IS NOT NULL');
    const [finalNull] = await pool.query('SELECT COUNT(*) as total FROM users WHERE id IS NULL');
    
    console.log(`   Total users: ${finalUsers[0].total}`);
    console.log(`   Valid users: ${finalValid[0].total}`);
    console.log(`   Invalid users: ${finalNull[0].total}\n`);

    // Step 11: Show sample users
    console.log('📋 Sample users (last 10):');
    const [sampleUsers] = await pool.query(`
      SELECT id, name, email, phone 
      FROM users 
      WHERE id IS NOT NULL 
      ORDER BY id DESC 
      LIMIT 10
    `);
    
    if (sampleUsers.length > 0) {
      console.log('\nID  | Name                | Email                           | Phone');
      console.log('----|---------------------|--------------------------------|------------');
      sampleUsers.forEach(user => {
        const id = String(user.id).padEnd(3);
        const name = (user.name || 'N/A').substring(0, 19).padEnd(19);
        const email = (user.email || 'N/A').substring(0, 30).padEnd(30);
        const phone = (user.phone || 'N/A').substring(0, 10);
        console.log(`${id} | ${name} | ${email} | ${phone}`);
      });
    }

    console.log('\n✅ Cleanup and auto-increment setup complete!');
    console.log('\n📝 Summary:');
    console.log(`   - Deleted users with NULL IDs: ${nullUsers[0].total}`);
    console.log(`   - Remaining valid users: ${finalValid[0].total}`);
    console.log(`   - AUTO_INCREMENT enabled: ✅`);
    console.log(`   - Next auto ID will be: ${nextId}`);
    console.log('\n🎉 Users table is now clean and ready for production!');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      sqlMessage: error.sqlMessage
    });
    process.exit(1);
  }
}

cleanupUsersAndEnableAutoIncrement();
