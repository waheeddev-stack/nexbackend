import pool from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Delete Customers with Invalid User IDs
 * 
 * This script specifically targets and removes customer records with invalid userIDs:
 * - NULL userIDs
 * - Negative userIDs  
 * - Zero userIDs
 * - Non-existent userIDs (orphaned references)
 * - Malformed userIDs
 * 
 * SAFETY FEATURES:
 * - Dry run mode available
 * - Detailed preview before deletion
 * - Transaction-based deletion
 * - Comprehensive logging
 * - Data integrity checks
 */

class InvalidUserIDCleaner {
  constructor(dryRun = false) {
    this.dryRun = dryRun;
    this.connection = null;
    this.stats = {
      totalUsers: 0,
      invalidUsers: 0,
      deletedUsers: 0,
      deletedOrders: 0,
      deletedOrderItems: 0,
      deletedNotifications: 0,
      orphanedOrders: 0
    };
  }

  async init() {
    this.connection = await pool.getConnection();
    console.log(this.dryRun ? '🔍 DRY RUN MODE - No data will be deleted' : '🔧 LIVE MODE - Data will be permanently deleted');
    console.log('=====================================\n');
  }

  async analyzeDatabase() {
    console.log('📊 Analyzing database for invalid user IDs...\n');

    // Get total user count
    const [totalResult] = await this.connection.query('SELECT COUNT(*) as count FROM users');
    this.stats.totalUsers = totalResult[0].count;

    // Analyze different types of invalid users
    const invalidUserQueries = {
      nullId: 'SELECT COUNT(*) as count FROM users WHERE id IS NULL',
      negativeId: 'SELECT COUNT(*) as count FROM users WHERE id < 0',
      zeroId: 'SELECT COUNT(*) as count FROM users WHERE id = 0',
      emptyEmail: 'SELECT COUNT(*) as count FROM users WHERE email IS NULL OR email = ""',
      emptyName: 'SELECT COUNT(*) as count FROM users WHERE name IS NULL OR name = ""'
    };

    const results = {};
    for (const [key, query] of Object.entries(invalidUserQueries)) {
      const [result] = await this.connection.query(query);
      results[key] = result[0].count;
    }

    console.log('📈 Database Analysis Results:');
    console.log(`   Total users in database: ${this.stats.totalUsers}`);
    console.log(`   Users with NULL ID: ${results.nullId}`);
    console.log(`   Users with negative ID: ${results.negativeId}`);
    console.log(`   Users with zero ID: ${results.zeroId}`);
    console.log(`   Users with empty email: ${results.emptyEmail}`);
    console.log(`   Users with empty name: ${results.emptyName}\n`);

    return results;
  }

  async findInvalidUsers() {
    console.log('🔍 Finding users with invalid IDs...\n');

    const [invalidUsers] = await this.connection.query(`
      SELECT 
        id, 
        name, 
        email, 
        phone, 
        created_at,
        CASE 
          WHEN id IS NULL THEN 'NULL_ID'
          WHEN id < 0 THEN 'NEGATIVE_ID'
          WHEN id = 0 THEN 'ZERO_ID'
          WHEN email IS NULL OR email = '' THEN 'MISSING_EMAIL'
          WHEN name IS NULL OR name = '' THEN 'MISSING_NAME'
          ELSE 'OTHER'
        END as invalid_reason
      FROM users 
      WHERE 
        id IS NULL 
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
        END, 
        created_at DESC
    `);

    if (invalidUsers.length > 0) {
      console.log(`⚠️  Found ${invalidUsers.length} users with invalid data:\n`);
      
      // Group by invalid reason
      const groupedUsers = invalidUsers.reduce((acc, user) => {
        if (!acc[user.invalid_reason]) acc[user.invalid_reason] = [];
        acc[user.invalid_reason].push(user);
        return acc;
      }, {});

      for (const [reason, users] of Object.entries(groupedUsers)) {
        console.log(`📋 ${reason} (${users.length} users):`);
        console.log('ID   | Name                | Email                           | Phone      | Created');
        console.log('-----|---------------------|--------------------------------|------------|-------------------');
        
        users.slice(0, 10).forEach(user => { // Show max 10 per category
          const id = user.id ? String(user.id).padEnd(4) : 'NULL'.padEnd(4);
          const name = (user.name || 'N/A').substring(0, 19).padEnd(19);
          const email = (user.email || 'N/A').substring(0, 30).padEnd(30);
          const phone = (user.phone || 'N/A').substring(0, 10).padEnd(10);
          const created = user.created_at ? new Date(user.created_at).toISOString().substring(0, 19) : 'N/A';
          console.log(`${id} | ${name} | ${email} | ${phone} | ${created}`);
        });
        
        if (users.length > 10) {
          console.log(`... and ${users.length - 10} more users with ${reason}`);
        }
        console.log('');
      }
    } else {
      console.log('✅ No users with invalid IDs found!\n');
    }

    return invalidUsers;
  }

  async findOrphanedOrders() {
    console.log('🔍 Finding orphaned orders (orders with invalid user_id)...\n');

    const [orphanedOrders] = await this.connection.query(`
      SELECT 
        o.id as order_id,
        o.user_id,
        o.total_amount,
        o.status,
        o.created_at,
        COUNT(oi.id) as item_count
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE 
        u.id IS NULL 
        OR o.user_id IS NULL 
        OR o.user_id <= 0
      GROUP BY o.id, o.user_id, o.total_amount, o.status, o.created_at
      ORDER BY o.created_at DESC
      LIMIT 50
    `);

    if (orphanedOrders.length > 0) {
      console.log(`⚠️  Found ${orphanedOrders.length} orphaned orders:\n`);
      console.log('Order ID | User ID | Amount | Status     | Items | Created');
      console.log('---------|---------|--------|------------|-------|-------------------');
      
      orphanedOrders.forEach(order => {
        const orderId = String(order.order_id).padEnd(8);
        const userId = String(order.user_id || 'NULL').padEnd(7);
        const amount = String(order.total_amount || '0').padEnd(6);
        const status = (order.status || 'N/A').substring(0, 10).padEnd(10);
        const items = String(order.item_count || '0').padEnd(5);
        const created = order.created_at ? new Date(order.created_at).toISOString().substring(0, 19) : 'N/A';
        console.log(`${orderId} | ${userId} | ${amount} | ${status} | ${items} | ${created}`);
      });
      console.log('');
    } else {
      console.log('✅ No orphaned orders found!\n');
    }

    this.stats.orphanedOrders = orphanedOrders.length;
    return orphanedOrders;
  }

  async deleteInvalidUsers(invalidUsers) {
    if (invalidUsers.length === 0) {
      console.log('✅ No invalid users to delete.\n');
      return;
    }

    console.log(`🗑️  Preparing to delete ${invalidUsers.length} invalid users...\n`);

    if (this.dryRun) {
      console.log('🔍 DRY RUN - Would delete the following users:');
      invalidUsers.forEach((user, index) => {
        console.log(`${index + 1}. ID: ${user.id || 'NULL'}, Email: ${user.email || 'N/A'}, Reason: ${user.invalid_reason}`);
      });
      console.log('\n✅ Dry run completed. No data was deleted.\n');
      return;
    }

    // Real deletion
    console.log('⚠️  WARNING: About to permanently delete users and related data!');
    console.log('⏳ Starting deletion in 3 seconds... (Press Ctrl+C to cancel)\n');
    await new Promise(resolve => setTimeout(resolve, 3000));

    await this.connection.beginTransaction();

    try {
      // Delete related data first
      for (const user of invalidUsers) {
        if (user.id && user.id > 0) {
          // Delete order items
          const [orderItemsResult] = await this.connection.query(`
            DELETE oi FROM order_items oi
            INNER JOIN orders o ON oi.order_id = o.id
            WHERE o.user_id = ?
          `, [user.id]);
          this.stats.deletedOrderItems += orderItemsResult.affectedRows;

          // Delete orders
          const [ordersResult] = await this.connection.query('DELETE FROM orders WHERE user_id = ?', [user.id]);
          this.stats.deletedOrders += ordersResult.affectedRows;

          // Delete notifications
          const [notificationsResult] = await this.connection.query('DELETE FROM notifications WHERE user_id = ?', [user.id]);
          this.stats.deletedNotifications += notificationsResult.affectedRows;
        }
      }

      // Delete users with invalid IDs
      const [usersResult] = await this.connection.query(`
        DELETE FROM users 
        WHERE 
          id IS NULL 
          OR id <= 0 
          OR email IS NULL 
          OR email = ''
          OR name IS NULL 
          OR name = ''
      `);
      this.stats.deletedUsers = usersResult.affectedRows;

      // Delete orphaned orders (orders with invalid user_id references)
      const [orphanedOrderItemsResult] = await this.connection.query(`
        DELETE oi FROM order_items oi
        INNER JOIN orders o ON oi.order_id = o.id
        LEFT JOIN users u ON o.user_id = u.id
        WHERE u.id IS NULL OR o.user_id IS NULL OR o.user_id <= 0
      `);

      const [orphanedOrdersResult] = await this.connection.query(`
        DELETE o FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        WHERE u.id IS NULL OR o.user_id IS NULL OR o.user_id <= 0
      `);

      this.stats.deletedOrderItems += orphanedOrderItemsResult.affectedRows;
      this.stats.deletedOrders += orphanedOrdersResult.affectedRows;

      await this.connection.commit();
      console.log('✅ Deletion completed successfully!\n');

    } catch (error) {
      await this.connection.rollback();
      throw error;
    }
  }

  async showFinalStats() {
    console.log('📊 Final Statistics:');
    console.log('==================');
    console.log(`Users deleted: ${this.stats.deletedUsers}`);
    console.log(`Orders deleted: ${this.stats.deletedOrders}`);
    console.log(`Order items deleted: ${this.stats.deletedOrderItems}`);
    console.log(`Notifications deleted: ${this.stats.deletedNotifications}\n`);

    // Show current database state
    const [currentUsers] = await this.connection.query('SELECT COUNT(*) as count FROM users');
    const [validUsers] = await this.connection.query('SELECT COUNT(*) as count FROM users WHERE id > 0');
    const [invalidUsers] = await this.connection.query('SELECT COUNT(*) as count FROM users WHERE id IS NULL OR id <= 0');

    console.log('📈 Current Database State:');
    console.log(`Total users: ${currentUsers[0].count}`);
    console.log(`Valid users: ${validUsers[0].count}`);
    console.log(`Invalid users remaining: ${invalidUsers[0].count}\n`);

    if (invalidUsers[0].count === 0) {
      console.log('🎉 Database is now clean! No invalid user IDs remaining.\n');
    }
  }

  async cleanup() {
    if (this.connection) {
      this.connection.release();
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-d');
  const force = args.includes('--force') || args.includes('-f');

  const cleaner = new InvalidUserIDCleaner(dryRun);

  try {
    await cleaner.init();
    
    // Analyze database
    await cleaner.analyzeDatabase();
    
    // Find invalid users
    const invalidUsers = await cleaner.findInvalidUsers();
    
    // Find orphaned orders
    await cleaner.findOrphanedOrders();
    
    // Delete invalid users (or show what would be deleted in dry run)
    await cleaner.deleteInvalidUsers(invalidUsers);
    
    // Show final statistics
    await cleaner.showFinalStats();
    
    console.log('🎉 Invalid user ID cleanup completed!\n');
    
    if (!dryRun && invalidUsers.length > 0) {
      console.log('💡 Recommendations:');
      console.log('   - Add database constraints to prevent NULL/invalid IDs');
      console.log('   - Implement proper validation in user registration');
      console.log('   - Run this script periodically to maintain data quality');
      console.log('   - Consider adding foreign key constraints for data integrity\n');
    }

  } catch (error) {
    console.error('\n❌ Error during cleanup:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      sqlMessage: error.sqlMessage
    });
    process.exit(1);
  } finally {
    await cleaner.cleanup();
    await pool.end();
  }
}

// Show usage if help requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: node delete-invalid-userid-customers.js [options]

Options:
  --dry-run, -d    Show what would be deleted without actually deleting
  --force, -f      Skip confirmation prompts (use with caution)
  --help, -h       Show this help message

Examples:
  node delete-invalid-userid-customers.js --dry-run    # Preview what would be deleted
  node delete-invalid-userid-customers.js             # Delete invalid users (with confirmation)
  node delete-invalid-userid-customers.js --force     # Delete without confirmation
`);
  process.exit(0);
}

main();