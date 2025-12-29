import 'dotenv/config';
import pool from '../config/db.js';

async function checkStatuses() {
  try {
    console.log('🔍 Checking subscription statuses in database...\n');
    
    // Get all shopkeepers with their subscription status
    const [shopkeepers] = await pool.query(`
      SELECT id, name, shop_name, subscription_status, trial_start_date, next_payment_due, last_payment_date
      FROM shopkeepers
      ORDER BY id DESC
      LIMIT 15
    `);
    
    console.log(`📊 Found ${shopkeepers.length} shopkeepers:\n`);
    
    // Group by status
    const statusCounts = {};
    shopkeepers.forEach(s => {
      const status = s.subscription_status || 'null';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    
    console.log('Status Distribution:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
    
    console.log('\n📋 Recent Shopkeepers:');
    shopkeepers.forEach(s => {
      console.log(`  ${s.id}: ${s.name} (${s.shop_name}) - Status: ${s.subscription_status || 'NULL'}`);
    });
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkStatuses();
