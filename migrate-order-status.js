import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from nexbackend directory
dotenv.config({ path: path.join(__dirname, '.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 4000,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function migrateOrderStatus() {
  let connection;
  
  try {
    console.log('🔄 Starting Order Status Migration...\n');
    
    connection = await pool.getConnection();
    
    // STEP 1: Check current state
    console.log('📊 STEP 1: Current Status Distribution');
    console.log('═'.repeat(60));
    
    const [currentStatus] = await connection.query(`
      SELECT 
        status,
        COUNT(*) as count,
        CONCAT(ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM orders), 2), '%') as percentage
      FROM orders
      GROUP BY status
      ORDER BY count DESC
    `);
    
    console.table(currentStatus);
    
    // STEP 2: Migrate 'Processing' to 'Pending'
    console.log('\n🔄 STEP 2: Migrating Processing → Pending');
    console.log('═'.repeat(60));
    
    const [processingResult] = await connection.query(`
      UPDATE orders 
      SET status = 'Pending' 
      WHERE status = 'Processing'
    `);
    
    console.log(`✅ Migrated ${processingResult.affectedRows} orders from Processing to Pending`);
    
    // STEP 3: Migrate 'Delivered' to 'Completed'
    console.log('\n🔄 STEP 3: Migrating Delivered → Completed');
    console.log('═'.repeat(60));
    
    const [deliveredResult] = await connection.query(`
      UPDATE orders 
      SET status = 'Completed' 
      WHERE status = 'Delivered'
    `);
    
    console.log(`✅ Migrated ${deliveredResult.affectedRows} orders from Delivered to Completed`);
    
    // STEP 4: Verify migration
    console.log('\n📊 STEP 4: Status Distribution After Migration');
    console.log('═'.repeat(60));
    
    const [afterStatus] = await connection.query(`
      SELECT 
        status,
        COUNT(*) as count,
        CONCAT(ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM orders), 2), '%') as percentage
      FROM orders
      GROUP BY status
      ORDER BY count DESC
    `);
    
    console.table(afterStatus);
    
    // STEP 5: Check for invalid statuses
    console.log('\n🔍 STEP 5: Checking for Invalid Statuses');
    console.log('═'.repeat(60));
    
    const [invalidStatus] = await connection.query(`
      SELECT 
        status,
        COUNT(*) as count
      FROM orders
      WHERE status NOT IN ('Pending', 'Completed', 'Cancelled')
      GROUP BY status
    `);
    
    if (invalidStatus.length > 0) {
      console.log('⚠️  Found invalid statuses:');
      console.table(invalidStatus);
      throw new Error('Invalid statuses found! Migration cannot proceed.');
    } else {
      console.log('✅ No invalid statuses found');
    }
    
    // STEP 6: Update ENUM definition
    console.log('\n🔄 STEP 6: Updating ENUM Definition');
    console.log('═'.repeat(60));
    
    await connection.query(`
      ALTER TABLE orders 
      MODIFY COLUMN status ENUM('Pending', 'Completed', 'Cancelled') 
      DEFAULT 'Pending'
    `);
    
    console.log('✅ ENUM updated to: Pending, Completed, Cancelled');
    
    // STEP 7: Verify column definition
    console.log('\n📋 STEP 7: Verifying Column Definition');
    console.log('═'.repeat(60));
    
    const [columnDef] = await connection.query(`
      SHOW COLUMNS FROM orders LIKE 'status'
    `);
    
    console.table(columnDef);
    
    // STEP 8: Final summary
    console.log('\n📊 STEP 8: Final Summary');
    console.log('═'.repeat(60));
    
    const [summary] = await connection.query(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM orders
    `);
    
    console.table(summary);
    
    console.log('\n✅ Migration Complete!');
    console.log('═'.repeat(60));
    console.log('✅ Database now uses 3 statuses: Pending, Completed, Cancelled');
    console.log('✅ All orders migrated successfully');
    console.log('✅ ENUM definition updated');
    console.log('\n📝 Next Steps:');
    console.log('   1. Update backend validation arrays');
    console.log('   2. Update NexKirana status checks');
    console.log('   3. Test order creation and status updates');
    console.log('   4. Restart backend server');
    
  } catch (error) {
    console.error('\n❌ Migration Failed!');
    console.error('═'.repeat(60));
    console.error('Error:', error.message);
    console.error('\nStack trace:', error.stack);
    
    if (error.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD') {
      console.error('\n⚠️  This error means there are orders with invalid statuses.');
      console.error('   Run the check query first to identify them.');
    }
    
    process.exit(1);
  } finally {
    if (connection) {
      connection.release();
    }
    await pool.end();
  }
}

// Run migration
migrateOrderStatus();
