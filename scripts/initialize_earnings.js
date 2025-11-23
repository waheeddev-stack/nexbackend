import pool from "../config/db.js";

// Script to initialize earnings records for existing shopkeepers
const initializeEarnings = async () => {
  try {
    console.log("Initializing earnings system...");

    // Get all shopkeepers who don't have earnings records
    const [shopkeepers] = await pool.query(`
      SELECT s.id, s.name, s.shop_name 
      FROM shopkeepers s 
      LEFT JOIN earnings e ON s.id = e.shopkeeper_id 
      WHERE e.shopkeeper_id IS NULL
    `);

    console.log(`Found ${shopkeepers.length} shopkeepers without earnings records`);

    // Create earnings records for each shopkeeper
    for (const shopkeeper of shopkeepers) {
      await pool.query(
        `INSERT INTO earnings (shopkeeper_id, last_payment_date, next_payment_date) 
         VALUES (?, CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 15 DAY))`,
        [shopkeeper.id]
      );
      
      console.log(`Created earnings record for ${shopkeeper.name} (${shopkeeper.shop_name})`);
    }

    // Calculate earnings for existing delivered orders
    const [deliveredOrders] = await pool.query(`
      SELECT o.id, o.shopkeeper_id, o.total_amount, o.created_at
      FROM orders o
      LEFT JOIN order_earnings oe ON o.id = oe.order_id
      WHERE o.status = 'delivered' AND oe.order_id IS NULL
    `);

    console.log(`Found ${deliveredOrders.length} delivered orders without earnings records`);

    for (const order of deliveredOrders) {
      const earning_amount = order.total_amount <= 100 ? 5 : 
                           order.total_amount <= 300 ? 8 : 15;
      
      const earning_rate = order.total_amount <= 100 ? '5 (≤100)' : 
                          order.total_amount <= 300 ? '8 (100-300)' : '15 (>300)';

      // Insert order earnings record
      await pool.query(
        `INSERT INTO order_earnings 
         (order_id, shopkeeper_id, order_amount, earning_amount, earning_rate, payment_cycle_start, payment_cycle_end, is_paid)
         VALUES (?, ?, ?, ?, ?, ?, ?, FALSE)`,
        [
          order.id,
          order.shopkeeper_id,
          order.total_amount,
          earning_amount,
          earning_rate,
          order.created_at,
          new Date(new Date(order.created_at).getTime() + 15 * 24 * 60 * 60 * 1000)
        ]
      );

      // Update shopkeeper's pending amount
      await pool.query(
        `UPDATE earnings 
         SET pending_amount = pending_amount + ? 
         WHERE shopkeeper_id = ?`,
        [earning_amount, order.shopkeeper_id]
      );

      console.log(`Added earnings for order ${order.id}: ₹${earning_amount}`);
    }

    // Update payment statuses
    await pool.query(`
      UPDATE earnings 
      SET payment_status = CASE
          WHEN DATEDIFF(next_payment_date, CURDATE()) < 0 AND pending_amount > 0 THEN 'blocked'
          WHEN DATEDIFF(next_payment_date, CURDATE()) <= 2 AND pending_amount > 0 THEN 'overdue'
          WHEN DATEDIFF(next_payment_date, CURDATE()) <= 7 AND pending_amount > 0 THEN 'due_soon'
          ELSE 'active'
      END
      WHERE pending_amount > 0
    `);

    console.log("✅ Earnings system initialization completed!");
    console.log("📊 Summary:");
    
    const [summary] = await pool.query(`
      SELECT 
        COUNT(*) as total_shopkeepers,
        SUM(pending_amount) as total_pending,
        SUM(total_paid) as total_paid,
        COUNT(CASE WHEN payment_status = 'blocked' THEN 1 END) as blocked_count,
        COUNT(CASE WHEN payment_status = 'overdue' THEN 1 END) as overdue_count,
        COUNT(CASE WHEN payment_status = 'due_soon' THEN 1 END) as due_soon_count
      FROM earnings
    `);

    console.log(`- Total shopkeepers: ${summary[0].total_shopkeepers}`);
    console.log(`- Total pending: ₹${summary[0].total_pending || 0}`);
    console.log(`- Total paid: ₹${summary[0].total_paid || 0}`);
    console.log(`- Blocked: ${summary[0].blocked_count}`);
    console.log(`- Overdue: ${summary[0].overdue_count}`);
    console.log(`- Due soon: ${summary[0].due_soon_count}`);

  } catch (error) {
    console.error("❌ Error initializing earnings system:", error);
  } finally {
    process.exit(0);
  }
};

// Run the initialization
initializeEarnings();