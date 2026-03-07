import pool from '../config/db.js';

/**
 * Fix Missing delivery_mode Values
 * 
 * This script updates existing orders where delivery_mode is NULL
 * by copying the value from order_type field.
 * 
 * This ensures the frontend can properly filter pickup vs delivery orders.
 */

async function fixDeliveryMode() {
  try {
    console.log('🔧 Starting delivery_mode fix...\n');

    // Check how many orders have NULL delivery_mode
    const [nullCount] = await pool.query(
      'SELECT COUNT(*) as count FROM orders WHERE delivery_mode IS NULL'
    );
    
    console.log(`📊 Found ${nullCount[0].count} orders with NULL delivery_mode`);

    if (nullCount[0].count === 0) {
      console.log('✅ All orders already have delivery_mode set!');
      process.exit(0);
    }

    // Update delivery_mode to match order_type where it's NULL
    const [result] = await pool.query(`
      UPDATE orders 
      SET delivery_mode = order_type 
      WHERE delivery_mode IS NULL 
        AND order_type IS NOT NULL
    `);

    console.log(`✅ Updated ${result.affectedRows} orders`);

    // Check for orders where both are NULL (shouldn't happen, but let's be safe)
    const [bothNull] = await pool.query(
      'SELECT COUNT(*) as count FROM orders WHERE delivery_mode IS NULL AND order_type IS NULL'
    );

    if (bothNull[0].count > 0) {
      console.log(`⚠️  Warning: ${bothNull[0].count} orders have both delivery_mode and order_type as NULL`);
      console.log('   Setting these to "pickup" as default...');
      
      await pool.query(`
        UPDATE orders 
        SET delivery_mode = 'pickup', order_type = 'pickup'
        WHERE delivery_mode IS NULL AND order_type IS NULL
      `);
      
      console.log('✅ Default values set');
    }

    // Verify the fix
    const [verification] = await pool.query(`
      SELECT 
        delivery_mode,
        COUNT(*) as count
      FROM orders
      GROUP BY delivery_mode
    `);

    console.log('\n📊 Final delivery_mode distribution:');
    verification.forEach(row => {
      console.log(`   ${row.delivery_mode || 'NULL'}: ${row.count} orders`);
    });

    console.log('\n✅ delivery_mode fix complete!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error fixing delivery_mode:', error);
    process.exit(1);
  }
}

fixDeliveryMode();
