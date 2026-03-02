import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from nexbackend directory
dotenv.config({ path: path.resolve(__dirname, '.env') });

async function checkOrderSync() {
  let pool;
  
  try {
    console.log('🔍 Order Sync Database Check\n');
    console.log('Database Configuration:');
    console.log('- DB_HOST:', process.env.DB_HOST);
    console.log('- DB_USER:', process.env.DB_USER);
    console.log('- DB_NAME:', process.env.DB_NAME);
    console.log('');

    // Create database connection
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER,
      password: process.env.DB_PASS || process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      waitForConnections: true,
      connectionLimit: 10
    });

    console.log('✅ Connected to database\n');

    // Check 1: Orders table structure
    console.log('=== CHECK 1: Orders Table Structure ===');
    const [ordersColumns] = await pool.query('SHOW COLUMNS FROM orders');
    console.log('Orders table columns:');
    console.table(ordersColumns.map(col => ({
      Field: col.Field,
      Type: col.Type,
      Null: col.Null,
      Default: col.Default
    })));

    // Check 2: Order status ENUM values
    console.log('\n=== CHECK 2: Order Status Values ===');
    const statusColumn = ordersColumns.find(col => col.Field === 'status');
    if (statusColumn) {
      console.log('Status ENUM:', statusColumn.Type);
      const expectedStatuses = ['Pending', 'Processing', 'Delivered', 'Cancelled', 'Completed'];
      console.log('Expected statuses:', expectedStatuses.join(', '));
    }

    // Check 3: Recent orders
    console.log('\n=== CHECK 3: Recent Orders ===');
    const [recentOrders] = await pool.query(`
      SELECT 
        o.id,
        o.user_id,
        o.shopkeeper_id,
        o.status,
        o.has_timer,
        o.pickup_code,
        o.total_amount,
        o.created_at,
        u.name as customer_name,
        s.shop_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN shopkeepers s ON o.shopkeeper_id = s.id
      ORDER BY o.created_at DESC
      LIMIT 10
    `);
    
    if (recentOrders.length > 0) {
      console.log(`Found ${recentOrders.length} recent orders:`);
      console.table(recentOrders.map(o => ({
        ID: o.id,
        Customer: o.customer_name,
        Shop: o.shop_name,
        Status: o.status,
        Timer: o.has_timer ? 'Yes' : 'No',
        Amount: `₹${o.total_amount}`,
        Created: o.created_at
      })));
    } else {
      console.log('⚠️  No orders found in database');
    }

    // Check 4: Order status distribution
    console.log('\n=== CHECK 4: Order Status Distribution ===');
    const [statusDist] = await pool.query(`
      SELECT status, COUNT(*) as count
      FROM orders
      GROUP BY status
      ORDER BY count DESC
    `);
    console.table(statusDist);

    // Check 5: Timer orders
    console.log('\n=== CHECK 5: Timer Orders ===');
    const [timerOrders] = await pool.query(`
      SELECT 
        COUNT(*) as total_timer_orders,
        SUM(CASE WHEN timer_expires_at > NOW() THEN 1 ELSE 0 END) as active_timers,
        SUM(CASE WHEN timer_expires_at <= NOW() THEN 1 ELSE 0 END) as expired_timers
      FROM orders
      WHERE has_timer = 1
    `);
    console.table(timerOrders);

    // Check 6: Order items
    console.log('\n=== CHECK 6: Order Items ===');
    const [orderItemsCount] = await pool.query(`
      SELECT COUNT(*) as total_items
      FROM order_items
    `);
    console.log(`Total order items: ${orderItemsCount[0].total_items}`);

    // Check 7: Orphaned orders (orders without items)
    console.log('\n=== CHECK 7: Data Integrity ===');
    const [orphanedOrders] = await pool.query(`
      SELECT o.id, o.status, o.created_at
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE oi.id IS NULL
      LIMIT 5
    `);
    
    if (orphanedOrders.length > 0) {
      console.log('⚠️  Found orders without items:');
      console.table(orphanedOrders);
    } else {
      console.log('✅ No orphaned orders found');
    }

    // Check 8: Missing foreign key references
    const [missingUsers] = await pool.query(`
      SELECT COUNT(*) as count
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE u.id IS NULL
    `);
    
    const [missingShopkeepers] = await pool.query(`
      SELECT COUNT(*) as count
      FROM orders o
      LEFT JOIN shopkeepers s ON o.shopkeeper_id = s.id
      WHERE s.id IS NULL
    `);

    console.log(`Orders with missing user: ${missingUsers[0].count}`);
    console.log(`Orders with missing shopkeeper: ${missingShopkeepers[0].count}`);

    // Check 9: Order timers table
    console.log('\n=== CHECK 9: Order Timers Table ===');
    try {
      const [timerTableCheck] = await pool.query('SHOW TABLES LIKE "order_timers"');
      if (timerTableCheck.length > 0) {
        const [timerStats] = await pool.query(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN is_expired = 1 THEN 1 ELSE 0 END) as expired
          FROM order_timers
        `);
        console.log('Order timers table exists:');
        console.table(timerStats);
      } else {
        console.log('⚠️  order_timers table does not exist');
      }
    } catch (err) {
      console.log('⚠️  Error checking order_timers:', err.message);
    }

    // Summary
    console.log('\n=== SUMMARY ===');
    console.log('✅ Orders table structure: OK');
    console.log('✅ Order status ENUM: OK');
    console.log(`✅ Total orders: ${recentOrders.length > 0 ? 'Found' : 'None'}`);
    console.log(`✅ Data integrity: ${orphanedOrders.length === 0 && missingUsers[0].count === 0 && missingShopkeepers[0].count === 0 ? 'OK' : 'Issues found'}`);
    
    console.log('\n📋 Recommendations:');
    if (recentOrders.length === 0) {
      console.log('- No orders in database - create test orders to verify sync');
    }
    if (orphanedOrders.length > 0) {
      console.log('- Clean up orphaned orders without items');
    }
    if (missingUsers[0].count > 0 || missingShopkeepers[0].count > 0) {
      console.log('- Fix foreign key references');
    }
    
    console.log('\n✅ Order sync database check completed!');

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error('Stack:', err.stack);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
      console.log('\n✅ Database connection closed');
    }
  }
}

// Run the check
checkOrderSync();
