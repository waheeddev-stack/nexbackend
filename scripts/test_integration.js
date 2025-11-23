import pool from "../config/db.js";

// Script to test the integration between all components
const testIntegration = async () => {
  try {
    console.log("🧪 Testing NexKirana Integration...\n");

    // Test 1: Check database tables exist
    console.log("1. Checking database tables...");
    const tables = ['users', 'shopkeepers', 'orders', 'earnings', 'earnings_history', 'order_earnings', 'payment_info', 'admins'];
    
    for (const table of tables) {
      try {
        const [rows] = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`   ✅ ${table}: ${rows[0].count} records`);
      } catch (error) {
        console.log(`   ❌ ${table}: Table missing or error`);
      }
    }

    // Test 2: Check admin account exists
    console.log("\n2. Checking admin account...");
    const [adminRows] = await pool.query("SELECT email FROM admins");
    if (adminRows.length > 0) {
      console.log(`   ✅ Admin account exists: ${adminRows[0].email}`);
    } else {
      console.log("   ⚠️  No admin account found. Run 'npm run generate-admin-hash' and create admin manually.");
    }

    // Test 3: Check shopkeepers with earnings
    console.log("\n3. Checking shopkeeper earnings integration...");
    const [shopkeeperStats] = await pool.query(`
      SELECT 
        COUNT(s.id) as total_shopkeepers,
        COUNT(e.id) as shopkeepers_with_earnings,
        SUM(e.pending_amount) as total_pending,
        SUM(e.total_paid) as total_paid
      FROM shopkeepers s
      LEFT JOIN earnings e ON s.id = e.shopkeeper_id
    `);
    
    const stats = shopkeeperStats[0];
    console.log(`   📊 Total shopkeepers: ${stats.total_shopkeepers}`);
    console.log(`   📊 With earnings records: ${stats.shopkeepers_with_earnings}`);
    console.log(`   💰 Total pending: ₹${stats.total_pending || 0}`);
    console.log(`   💰 Total paid: ₹${stats.total_paid || 0}`);

    if (stats.total_shopkeepers > stats.shopkeepers_with_earnings) {
      console.log("   ⚠️  Some shopkeepers missing earnings records. Run 'npm run init-earnings'");
    }

    // Test 4: Check payment statuses
    console.log("\n4. Checking payment statuses...");
    const [statusStats] = await pool.query(`
      SELECT 
        payment_status,
        COUNT(*) as count
      FROM earnings
      GROUP BY payment_status
    `);

    statusStats.forEach(row => {
      const emoji = row.payment_status === 'blocked' ? '🚫' : 
                   row.payment_status === 'overdue' ? '⚠️' : 
                   row.payment_status === 'due_soon' ? '⏰' : '✅';
      console.log(`   ${emoji} ${row.payment_status}: ${row.count} shopkeepers`);
    });

    // Test 5: Check order earnings integration
    console.log("\n5. Checking order earnings integration...");
    const [orderStats] = await pool.query(`
      SELECT 
        COUNT(o.id) as total_delivered_orders,
        COUNT(oe.id) as orders_with_earnings,
        SUM(oe.earning_amount) as total_earnings_calculated
      FROM orders o
      LEFT JOIN order_earnings oe ON o.id = oe.order_id
      WHERE o.status = 'delivered'
    `);

    const orderStatsData = orderStats[0];
    console.log(`   📦 Total delivered orders: ${orderStatsData.total_delivered_orders}`);
    console.log(`   📦 With earnings calculated: ${orderStatsData.orders_with_earnings}`);
    console.log(`   💰 Total earnings calculated: ₹${orderStatsData.total_earnings_calculated || 0}`);

    if (orderStatsData.total_delivered_orders > orderStatsData.orders_with_earnings) {
      console.log("   ⚠️  Some delivered orders missing earnings. Run 'npm run init-earnings'");
    }

    // Test 6: Check payment info
    console.log("\n6. Checking payment information...");
    const [paymentInfo] = await pool.query("SELECT * FROM payment_info WHERE is_active = TRUE");
    if (paymentInfo.length > 0) {
      const info = paymentInfo[0];
      console.log(`   ✅ Payment info configured:`);
      console.log(`      UPI ID: ${info.upi_id || 'Not set'}`);
      console.log(`      Bank Account: ${info.bank_account || 'Not set'}`);
      console.log(`      Bank Name: ${info.bank_name || 'Not set'}`);
    } else {
      console.log("   ⚠️  No payment information configured. Set up via admin panel.");
    }

    console.log("\n🎉 Integration test completed!");
    console.log("\n📋 Next steps:");
    console.log("   1. Ensure admin account is created and can login");
    console.log("   2. Configure payment information via admin panel");
    console.log("   3. Test shopkeeper earnings page");
    console.log("   4. Test payment blocking functionality");
    console.log("   5. Set up cron job to run 'npm run update-payment-status' daily");

  } catch (error) {
    console.error("❌ Integration test failed:", error);
  } finally {
    process.exit(0);
  }
};

// Run the test
testIntegration();