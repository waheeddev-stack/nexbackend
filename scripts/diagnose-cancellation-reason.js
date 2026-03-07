import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
};

async function diagnoseCancellationReason() {
  let connection;
  
  try {
    console.log('🔍 Diagnosing Cancellation Reason Feature\n');
    console.log('🔌 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected\n');

    // 1. Check if column exists
    console.log('📋 Step 1: Checking if cancellation_reason column exists...');
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'orders' 
        AND COLUMN_NAME = 'cancellation_reason'
    `, [process.env.DB_NAME]);

    if (columns.length === 0) {
      console.log('❌ PROBLEM: Column does not exist!');
      console.log('   Run: node scripts/add-cancellation-reason-column.js\n');
      return;
    }
    console.log('✅ Column exists:', columns[0], '\n');

    // 2. Check all cancelled orders
    console.log('📋 Step 2: Checking all cancelled orders...');
    const [allCancelled] = await connection.query(`
      SELECT 
        id, 
        user_id,
        shopkeeper_id,
        status, 
        cancellation_reason,
        created_at,
        CHAR_LENGTH(cancellation_reason) as reason_length
      FROM orders 
      WHERE status = 'Cancelled' 
      ORDER BY created_at DESC 
      LIMIT 10
    `);

    console.log(`Found ${allCancelled.length} cancelled orders:\n`);
    
    let withReason = 0;
    let withoutReason = 0;
    
    allCancelled.forEach(order => {
      const hasReason = order.cancellation_reason && order.cancellation_reason.trim().length > 0;
      if (hasReason) withReason++;
      else withoutReason++;
      
      console.log(`Order #${order.id}:`);
      console.log(`  User ID: ${order.user_id}`);
      console.log(`  Shopkeeper ID: ${order.shopkeeper_id}`);
      console.log(`  Status: ${order.status}`);
      console.log(`  Has Reason: ${hasReason ? '✅ YES' : '❌ NO'}`);
      if (hasReason) {
        console.log(`  Reason: "${order.cancellation_reason}"`);
        console.log(`  Length: ${order.reason_length} characters`);
      }
      console.log(`  Date: ${order.created_at}`);
      console.log('');
    });

    console.log('📊 Summary:');
    console.log(`   Orders with reason: ${withReason}`);
    console.log(`   Orders without reason: ${withoutReason}\n`);

    // 3. Test the exact query used by the API
    console.log('📋 Step 3: Testing the API query format...');
    
    if (allCancelled.length > 0) {
      const testUserId = allCancelled[0].user_id;
      console.log(`   Testing with user_id: ${testUserId}`);
      
      const [apiResult] = await connection.query(`
        SELECT 
          o.id AS order_id,
          o.status,
          o.total_amount,
          o.created_at,
          o.delivery_address,
          o.pickup_code,
          o.delivery_mode,
          o.order_type,
          o.cancellation_reason,
          o.scheduled_time
        FROM orders o
        WHERE o.user_id = ? AND o.status = 'Cancelled'
        ORDER BY o.created_at DESC
        LIMIT 1
      `, [testUserId]);

      if (apiResult.length > 0) {
        console.log('   ✅ API query works correctly');
        console.log('   Sample result:');
        console.log('   {');
        console.log(`     order_id: ${apiResult[0].order_id},`);
        console.log(`     status: "${apiResult[0].status}",`);
        console.log(`     cancellation_reason: ${apiResult[0].cancellation_reason ? `"${apiResult[0].cancellation_reason}"` : 'null'},`);
        console.log(`     created_at: "${apiResult[0].created_at}"`);
        console.log('   }\n');
      }
    }

    // 4. Provide recommendations
    console.log('💡 Recommendations:\n');
    
    if (withReason === 0) {
      console.log('⚠️  No cancelled orders have a cancellation_reason set');
      console.log('   This is expected if:');
      console.log('   - All cancelled orders are old (before feature was added)');
      console.log('   - No shopkeeper has cancelled an order since the update\n');
      console.log('   To test the feature:');
      console.log('   1. Have a shopkeeper cancel a new order');
      console.log('   2. Ensure they provide a cancellation reason');
      console.log('   3. Check if it appears in the customer app\n');
    } else {
      console.log('✅ Found orders with cancellation reasons!');
      console.log('   The feature should be working in the app');
      console.log('   If not visible, check:');
      console.log('   1. App has been rebuilt/reloaded');
      console.log('   2. User is viewing the correct cancelled order');
      console.log('   3. Order card is expanded to see details\n');
    }

    // 5. Show how to manually test
    console.log('🧪 Manual Test Instructions:\n');
    console.log('   Backend (Shopkeeper cancels order):');
    console.log('   POST /api/shopkeeper/orders/:orderId/status');
    console.log('   Body: {');
    console.log('     "status": "Cancelled",');
    console.log('     "cancellation_reason": "Product out of stock"');
    console.log('   }\n');
    console.log('   Frontend (Customer views order):');
    console.log('   1. Open NexKirana app');
    console.log('   2. Go to Orders tab');
    console.log('   3. Switch to "Cancelled" tab');
    console.log('   4. Tap on a cancelled order to expand');
    console.log('   5. Look for red box with "Sorry, order was cancelled"\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed');
    }
  }
}

diagnoseCancellationReason()
  .then(() => {
    console.log('\n✅ Diagnosis complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Diagnosis failed:', error);
    process.exit(1);
  });
