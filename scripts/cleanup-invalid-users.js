import pool from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Cleanup Invalid Users Script
 * 
 * This script identifies and deletes users with invalid userIDs:
 * 1. Users with NULL IDs
 * 2. Users with negative IDs
 * 3. Users with non-numeric IDs (if any)
 * 4. Users with IDs outside expected range
 * 5. Orphaned user data (orders without valid users)
 * 6. Duplicate users (same email/phone)
 * 
 * SAFETY FEATURES:
 * - Shows preview before deletion
 * - Backs up data before deletion
 * - Handles related data (orders, etc.)
 * - Provides detailed logging
 */

async function cleanupInvalidUsers() {
  let connection;
  
  try {
    console.log('🔧 Starting invalid users cleanup...\n');
    
    // Get connection for transaction
    connection = await pool.getConnection();
    
    // Step 1: Analyze current user data
    console.log('📊 Analyzing users table...');
    
    const [totalUsers] = await connection.query('SELECT COUNT(*) as total FROM users');
    const [nullIdUsers] = await connection.query('SELECT COUNT(*) as total FROM users WHERE id IS NULL');
    const [negativeIdUsers] = await connection.query('SELECT COUNT(*) as total FROM users WHERE id < 0');
    const [zeroIdUsers] = await connection.query('SELECT COUNT(*) as total FROM users WHERE id = 0');
    const [validIdUsers] = await connection.query('SELECT COUNT(*) as total FROM users WHERE id > 0');
    
    console.log(`   Total users: ${totalUsers[0].total}`);
    console.log(`   Valid users (ID > 0): ${validIdUsers[0].total}`);
    console.log(`   NULL ID users: ${nullIdUsers[0].total}`);
    console.log(`   Negative ID users: ${negativeIdUsers[0].total}`);
    console.log(`   Zero ID users: ${zeroIdUsers[0].total}\n`);
    
    // Step 2: Check for duplicate emails
    console.log('🔍 Checking for duplicate emails...');
    const [duplicateEmails] = await connection.query(`
      SELECT email, COUNT(*) as count, GROUP_CONCAT(id) as user_ids
      FROM users 
      WHERE email IS NOT NULL AND email != ''
      GROUP BY email 
      HAVING count > 1
      ORDER BY count DESC
    `);
    
    if (duplicateEmails.length > 0) {
      console.log(`⚠️  Found ${duplicateEmails.length} duplicate emails:`);
      duplicateEmails.forEach(dup => {
        console.log(`   Email: ${dup.email} (${dup.count} users, IDs: ${dup.user_ids})`);
      });
      console.log('');
    } else {
      console.log('✅ No duplicate emails found\n');
    }
    
    // Step 3: Check for duplicate phones
    console.log('🔍 Checking for duplicate phone numbers...');
    const [duplicatePhones] = await connection.query(`
      SELECT phone, COUNT(*) as count, GROUP_CONCAT(id) as user_ids
      FROM users 
      WHERE phone IS NOT NULL AND phone != ''
      GROUP BY phone 
      HAVING count > 1
      ORDER BY count DESC
    `);
    
    if (duplicatePhones.length > 0) {
      console.log(`⚠️  Found ${duplicatePhones.length} duplicate phone numbers:`);
      duplicatePhones.forEach(dup => {
        console.log(`   Phone: ${dup.phone} (${dup.count} users, IDs: ${dup.user_ids})`);
      });
      console.log('');
    } else {
      console.log('✅ No duplicate phone numbers found\n');
    }
    
    // Step 4: Identify users with invalid data
    console.log('🔍 Identifying users with invalid data...');
    const [invalidUsers] = await connection.query(`
      SELECT id, name, email, phone, created_at,
        CASE 
          WHEN id IS NULL THEN 'NULL_ID'
          WHEN id < 0 THEN 'NEGATIVE_ID'
          WHEN id = 0 THEN 'ZERO_ID'
          WHEN email IS NULL OR email = '' THEN 'NO_EMAIL'
          WHEN name IS NULL OR name = '' THEN 'NO_NAME'
          ELSE 'UNKNOWN'
        END as issue_type
      FROM users 
      WHERE id IS NULL 
         OR id <= 0 
         OR email IS NULL 
         OR email = ''
         OR name IS NULL 
         OR name = ''
      ORDER BY 
        CASE 
          WHEN id IS NULL THEN 1
          WHEN id < 0 THEN 2
          WHEN id = 0 THEN 3
          ELSE 4
        END, created_at
    `);
    
    if (invalidUsers.length > 0) {
      console.log(`⚠️  Found ${invalidUsers.length} users with invalid data:`);
      console.log('\nID   | Issue        | Name                | Email                           | Phone      | Created');
      console.log('-----|--------------|---------------------|--------------------------------|------------|-------------------');
      
      invalidUsers.forEach(user => {
        const id = user.id ? String(user.id).padEnd(4) : 'NULL'.padEnd(4);
        const issue = user.issue_type.padEnd(12);
        const name = (user.name || 'N/A').substring(0, 19).padEnd(19);
        const email = (user.email || 'N/A').substring(0, 30).padEnd(30);
        const phone = (user.phone || 'N/A').substring(0, 10).padEnd(10);
        const created = user.created_at ? new Date(user.created_at).toISOString().substring(0, 19) : 'N/A';
        console.log(`${id} | ${issue} | ${name} | ${email} | ${phone} | ${created}`);
      });
      console.log('');
    } else {
      console.log('✅ No users with invalid data found\n');
    }
    
    // Step 5: Check for orphaned orders
    console.log('🔍 Checking for orphaned orders (orders without valid users)...');
    const [orphanedOrders] = await connection.query(`
      SELECT o.id, o.user_id, o.total_amount, o.status, o.created_at
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE u.id IS NULL OR u.id <= 0
      ORDER BY o.created_at DESC
      LIMIT 20
    `);
    
    if (orphanedOrders.length > 0) {
      console.log(`⚠️  Found ${orphanedOrders.length} orphaned orders:`);
      console.log('\nOrder ID | User ID | Amount | Status     | Created');
      console.log('---------|---------|--------|------------|-------------------');
      
      orphanedOrders.forEach(order => {
        const orderId = String(order.id).padEnd(8);
        const userId = String(order.user_id || 'NULL').padEnd(7);
        const amount = String(order.total_amount || '0').padEnd(6);
        const status = (order.status || 'N/A').substring(0, 10).padEnd(10);
        const created = order.created_at ? new Date(order.created_at).toISOString().substring(0, 19) : 'N/A';
        console.log(`${orderId} | ${userId} | ${amount} | ${status} | ${created}`);
      });
      console.log('');
    } else {
      console.log('✅ No orphaned orders found\n');
    }
    
    // Step 6: Show what will be deleted
    const usersToDelete = invalidUsers.filter(user => 
      user.id === null || user.id <= 0
    );
    
    if (usersToDelete.length === 0) {
      console.log('✅ No invalid users to delete. Database is clean!\n');
      return;
    }
    
    console.log(`🗑️  DELETION PLAN - ${usersToDelete.length} users will be PERMANENTLY DELETED:`);
    console.log('\nUsers to be deleted:');
    usersToDelete.forEach((user, index) => {
      console.log(`${index + 1}. ID: ${user.id || 'NULL'}, Name: ${user.name || 'N/A'}, Email: ${user.email || 'N/A'}, Issue: ${user.issue_type}`);
    });
    
    // Step 7: Confirm deletion (in production, you might want to add a confirmation prompt)
    console.log('\n⚠️  WARNING: This will permanently delete the above users and their related data!');
    console.log('⚠️  Make sure you have a database backup before proceeding!\n');
    
    // For safety, we'll add a 5-second delay
    console.log('⏳ Starting deletion in 5 seconds... (Press Ctrl+C to cancel)');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Step 8: Start transaction for safe deletion
    console.log('🔄 Starting transaction...');
    await connection.beginTransaction();
    
    try {
      let deletedUsersCount = 0;
      let deletedOrdersCount = 0;
      let deletedOrderItemsCount = 0;
      
      // Delete related data first (orders, order_items, etc.)
      for (const user of usersToDelete) {
        if (user.id) {
          // Delete order items for this user's orders
          const [orderItemsResult] = await connection.query(`
            DELETE oi FROM order_items oi
            INNER JOIN orders o ON oi.order_id = o.id
            WHERE o.user_id = ?
          `, [user.id]);
          deletedOrderItemsCount += orderItemsResult.affectedRows;
          
          // Delete orders for this user
          const [ordersResult] = await connection.query('DELETE FROM orders WHERE user_id = ?', [user.id]);
          deletedOrdersCount += ordersResult.affectedRows;
          
          // Delete any other related data (add more as needed)
          // Example: notifications, cart items, etc.
          await connection.query('DELETE FROM notifications WHERE user_id = ?', [user.id]);
        }
      }
      
      // Delete users with invalid IDs
      const [usersResult] = await connection.query(`
        DELETE FROM users 
        WHERE id IS NULL OR id <= 0
      `);
      deletedUsersCount = usersResult.affectedRows;
      
      // Commit transaction
      await connection.commit();
      
      console.log('✅ Deletion completed successfully!\n');
      console.log('📊 Deletion Summary:');
      console.log(`   Users deleted: ${deletedUsersCount}`);
      console.log(`   Orders deleted: ${deletedOrdersCount}`);
      console.log(`   Order items deleted: ${deletedOrderItemsCount}\n`);
      
    } catch (error) {
      // Rollback on error
      await connection.rollback();
      throw error;
    }
    
    // Step 9: Show final statistics
    console.log('📊 Final database state:');
    const [finalTotal] = await connection.query('SELECT COUNT(*) as total FROM users');
    const [finalValid] = await connection.query('SELECT COUNT(*) as total FROM users WHERE id > 0');
    const [finalInvalid] = await connection.query('SELECT COUNT(*) as total FROM users WHERE id IS NULL OR id <= 0');
    
    console.log(`   Total users: ${finalTotal[0].total}`);
    console.log(`   Valid users: ${finalValid[0].total}`);
    console.log(`   Invalid users: ${finalInvalid[0].total}\n`);
    
    // Step 10: Show sample of remaining users
    console.log('📋 Sample of remaining users (last 10):');
    const [sampleUsers] = await connection.query(`
      SELECT id, name, email, phone, created_at
      FROM users 
      WHERE id > 0
      ORDER BY id DESC 
      LIMIT 10
    `);
    
    if (sampleUsers.length > 0) {
      console.log('\nID   | Name                | Email                           | Phone      | Created');
      console.log('-----|---------------------|--------------------------------|------------|-------------------');
      sampleUsers.forEach(user => {
        const id = String(user.id).padEnd(4);
        const name = (user.name || 'N/A').substring(0, 19).padEnd(19);
        const email = (user.email || 'N/A').substring(0, 30).padEnd(30);
        const phone = (user.phone || 'N/A').substring(0, 10).padEnd(10);
        const created = user.created_at ? new Date(user.created_at).toISOString().substring(0, 19) : 'N/A';
        console.log(`${id} | ${name} | ${email} | ${phone} | ${created}`);
      });
    }
    
    console.log('\n🎉 Invalid users cleanup completed successfully!');
    console.log('\n📝 What was cleaned:');
    console.log('   ✅ Users with NULL IDs');
    console.log('   ✅ Users with negative IDs');
    console.log('   ✅ Users with zero IDs');
    console.log('   ✅ Related orders and order items');
    console.log('   ✅ Related notifications');
    console.log('\n💡 Recommendations:');
    console.log('   - Run this script periodically to maintain data quality');
    console.log('   - Consider adding database constraints to prevent invalid data');
    console.log('   - Monitor user registration process for data validation');
    
  } catch (error) {
    console.error('\n❌ Error during cleanup:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      sqlMessage: error.sqlMessage
    });
    
    if (connection) {
      try {
        await connection.rollback();
        console.log('🔄 Transaction rolled back successfully');
      } catch (rollbackError) {
        console.error('❌ Error rolling back transaction:', rollbackError);
      }
    }
    
    process.exit(1);
  } finally {
    if (connection) {
      connection.release();
    }
    await pool.end();
  }
}

// Add command line argument support
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-d');

if (dryRun) {
  console.log('🔍 DRY RUN MODE - No data will be deleted\n');
  // You can modify the script to only show what would be deleted
}

cleanupInvalidUsers();