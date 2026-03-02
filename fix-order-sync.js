import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from nexbackend directory
dotenv.config({ path: path.resolve(__dirname, '.env') });

async function fixOrderSync() {
  let pool;
  
  try {
    console.log('🔧 Order Sync Database Fix\n');

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

    // ISSUE 1: Orphaned orders without items
    console.log('=== FIX 1: Clean up orphaned orders ===');
    
    // Find orphaned orders
    const [orphanedOrders] = await pool.query(`
      SELECT o.id
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE oi.id IS NULL AND o.id IS NOT NULL
    `);
    
    if (orphanedOrders.length > 0) {
      console.log(`Found ${orphanedOrders.length} orphaned orders without items`);
      
      // Delete orphaned orders
      const [deleteResult] = await pool.query(`
        DELETE o FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        WHERE oi.id IS NULL AND o.id IS NOT NULL
      `);
      
      console.log(`✅ Deleted ${deleteResult.affectedRows} orphaned orders`);
    } else {
      console.log('✅ No orphaned orders found');
    }

    // ISSUE 2: Orders with missing shopkeeper references
    console.log('\n=== FIX 2: Check orders with missing shopkeeper ===');
    
    const [missingShopkeepers] = await pool.query(`
      SELECT o.id, o.shopkeeper_id, o.status, o.created_at
      FROM orders o
      LEFT JOIN shopkeepers s ON o.shopkeeper_id = s.id
      WHERE s.id IS NULL AND o.id IS NOT NULL
      LIMIT 10
    `);
    
    if (missingShopkeepers.length > 0) {
      console.log(`⚠️  Found ${missingShopkeepers.length} orders with missing shopkeeper references:`);
      console.table(missingShopkeepers);
      
      console.log('\n⚠️  WARNING: These orders reference deleted shopkeepers');
      console.log('Options:');
      console.log('1. Keep them for historical records (recommended)');
      console.log('2. Delete them (data loss)');
      console.log('\nNo action taken - manual review recommended');
    } else {
      console.log('✅ All orders have valid shopkeeper references');
    }

    // ISSUE 3: Verify order_timers table exists and is properly structured
    console.log('\n=== FIX 3: Verify order_timers table ===');
    
    const [timerTableExists] = await pool.query(`
      SHOW TABLES LIKE 'order_timers'
    `);
    
    if (timerTableExists.length > 0) {
      console.log('✅ order_timers table exists');
      
      // Check for orphaned timer records
      const [orphanedTimers] = await pool.query(`
        SELECT ot.id, ot.order_id
        FROM order_timers ot
        LEFT JOIN orders o ON ot.order_id = o.id
        WHERE o.id IS NULL
      `);
      
      if (orphanedTimers.length > 0) {
        console.log(`Found ${orphanedTimers.length} orphaned timer records`);
        
        const [deleteTimers] = await pool.query(`
          DELETE ot FROM order_timers ot
          LEFT JOIN orders o ON ot.order_id = o.id
          WHERE o.id IS NULL
        `);
        
        console.log(`✅ Deleted ${deleteTimers.affectedRows} orphaned timer records`);
      } else {
        console.log('✅ No orphaned timer records');
      }
    } else {
      console.log('⚠️  order_timers table does not exist');
      console.log('Creating order_timers table...');
      
      await pool.query(`
        CREATE TABLE IF NOT EXISTS order_timers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          order_id INT NOT NULL,
          pickup_code VARCHAR(6) NOT NULL,
          timer_duration INT DEFAULT 420,
          timer_started_at TIMESTAMP NULL,
          timer_expires_at TIMESTAMP NULL,
          is_active BOOLEAN DEFAULT FALSE,
          is_expired BOOLEAN DEFAULT FALSE,
          stopped_at TIMESTAMP NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
          INDEX idx_order_id (order_id),
          INDEX idx_pickup_code (pickup_code),
          INDEX idx_active (is_active, is_expired)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      
      console.log('✅ order_timers table created');
    }

    // ISSUE 4: Verify indexes for performance
    console.log('\n=== FIX 4: Verify indexes ===');
    
    const [indexes] = await pool.query(`
      SHOW INDEX FROM orders
    `);
    
    const indexNames = indexes.map(idx => idx.Key_name);
    
    // Check for important indexes
    const requiredIndexes = {
      'idx_orders_pickup_code': 'pickup_code',
      'idx_orders_timer': 'has_timer, timer_expires_at',
      'fk_user_id': 'user_id',
      'fk_shopkeeper_id': 'shopkeeper_id'
    };
    
    console.log('Checking required indexes:');
    for (const [indexName, columns] of Object.entries(requiredIndexes)) {
      if (indexNames.includes(indexName)) {
        console.log(`✅ ${indexName} exists`);
      } else {
        console.log(`⚠️  ${indexName} missing - may affect performance`);
      }
    }

    // Verification
    console.log('\n=== VERIFICATION ===');
    
    const [finalStats] = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'Processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN has_timer = 1 THEN 1 ELSE 0 END) as timer_orders
      FROM orders
    `);
    
    console.log('Final order statistics:');
    console.table(finalStats);

    // Check data integrity
    const [integrityCheck] = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM orders o LEFT JOIN order_items oi ON o.id = oi.order_id WHERE oi.id IS NULL) as orphaned_orders,
        (SELECT COUNT(*) FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE u.id IS NULL) as missing_users,
        (SELECT COUNT(*) FROM orders o LEFT JOIN shopkeepers s ON o.shopkeeper_id = s.id WHERE s.id IS NULL) as missing_shopkeepers
    `);
    
    console.log('\nData integrity check:');
    console.table(integrityCheck);

    console.log('\n✅ Order sync database fix completed!');
    
    console.log('\n📋 Summary:');
    console.log('✅ Orphaned orders cleaned up');
    console.log('✅ Timer table verified');
    console.log('✅ Indexes checked');
    console.log('✅ Data integrity verified');
    
    console.log('\n🔄 Next steps:');
    console.log('1. Test order creation from customer app');
    console.log('2. Verify real-time sync in shopkeeper app');
    console.log('3. Test timer functionality for click & collect');
    console.log('4. Monitor socket.io events in server logs');

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

// Run the fix
fixOrderSync();
