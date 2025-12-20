import pool from '../config/db.js';

/**
 * Check why orders are not showing for shopkeeper
 */

async function checkOrdersIssue() {
  console.log('🔍 Checking Orders Issue\n');
  
  try {
    // Check if orders table exists and has data
    console.log('1. Checking orders table...');
    const [orders] = await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 5');
    console.log(`   Found ${orders.length} orders in database`);
    
    if (orders.length > 0) {
      console.log('\n   Recent orders:');
      for (const order of orders) {
        console.log(`   - Order #${order.id}: shopkeeper_id=${order.shopkeeper_id}, status=${order.status}, created=${order.created_at}`);
      }
    }
    
    // Check shopkeepers
    console.log('\n2. Checking shopkeepers...');
    const [shopkeepers] = await pool.query('SELECT id, name, shop_name, is_verified FROM shopkeepers');
    console.log(`   Found ${shopkeepers.length} shopkeepers`);
    
    if (shopkeepers.length > 0) {
      console.log('\n   Shopkeepers:');
      for (const shop of shopkeepers) {
        console.log(`   - Shopkeeper #${shop.id}: ${shop.shop_name || shop.name}, verified=${shop.is_verified}`);
      }
    }
    
    // Check order_items
    console.log('\n3. Checking order_items...');
    const [items] = await pool.query('SELECT * FROM order_items LIMIT 5');
    console.log(`   Found ${items.length} order items`);
    
    // Check if cancelled_by and cancellation_reason columns exist
    console.log('\n4. Checking orders table structure...');
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'orders'
      AND TABLE_SCHEMA = DATABASE()
      ORDER BY ORDINAL_POSITION
    `);
    
    console.log('   Orders table columns:');
    for (const col of columns) {
      console.log(`   - ${col.COLUMN_NAME}: ${col.DATA_TYPE} (nullable: ${col.IS_NULLABLE})`);
    }
    
    const hasCancelledBy = columns.some(c => c.COLUMN_NAME === 'cancelled_by');
    const hasCancellationReason = columns.some(c => c.COLUMN_NAME === 'cancellation_reason');
    
    if (!hasCancelledBy || !hasCancellationReason) {
      console.log('\n   ⚠️ Missing cancellation columns!');
      console.log('   Need to add: cancelled_by, cancellation_reason');
    }
    
    // Try the actual query that shopkeeper endpoint uses
    console.log('\n5. Testing shopkeeper orders query...');
    if (shopkeepers.length > 0) {
      const testShopkeeperId = shopkeepers[0].id;
      console.log(`   Testing with shopkeeper_id = ${testShopkeeperId}`);
      
      try {
        const [testOrders] = await pool.query(
          `SELECT 
            o.id AS order_id,
            o.user_id,
            o.shopkeeper_id,
            o.status,
            o.total_amount,
            o.created_at,
            o.credits_earned,
            o.latitude,
            o.longitude,
            o.delivery_address,
            o.cancelled_by,
            o.cancellation_reason,
            u.name AS customer_name,
            u.phone AS customer_phone,
            u.email AS customer_email
           FROM orders o
           LEFT JOIN users u ON o.user_id = u.id
           WHERE o.shopkeeper_id = ?
           ORDER BY o.created_at DESC`,
          [testShopkeeperId]
        );
        
        console.log(`   ✅ Query successful! Found ${testOrders.length} orders`);
        
        if (testOrders.length > 0) {
          console.log('\n   Sample order:');
          console.log(JSON.stringify(testOrders[0], null, 2));
        }
      } catch (queryError) {
        console.error('   ❌ Query failed:', queryError.message);
        
        if (queryError.message.includes('cancelled_by') || queryError.message.includes('cancellation_reason')) {
          console.log('\n   🔧 FIX: Need to add cancellation columns to orders table');
          console.log('   Run: node nexbackend/scripts/add-cancellation-columns.js');
        }
      }
    }
    
    console.log('\n✅ Diagnostic complete');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

checkOrdersIssue();
