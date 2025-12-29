import 'dotenv/config';
import pool from '../config/db.js';

async function resetToTrial() {
  try {
    console.log('🔄 Resetting shopkeepers to trial status...\n');
    
    // Reset all shopkeepers who are still within 90-day trial period
    const [result] = await pool.query(`
      UPDATE shopkeepers
      SET subscription_status = 'trial',
          next_payment_due = NULL,
          grace_period_end = NULL
      WHERE id IS NOT NULL 
        AND is_deleted = 0
        AND DATEDIFF(NOW(), COALESCE(trial_start_date, created_at)) < 90
    `);
    
    console.log(`✅ Reset ${result.affectedRows} shopkeepers to trial status\n`);
    
    // Show current status distribution
    const [stats] = await pool.query(`
      SELECT 
        subscription_status,
        COUNT(*) as count
      FROM shopkeepers
      WHERE id IS NOT NULL AND is_deleted = 0
      GROUP BY subscription_status
      ORDER BY count DESC
    `);
    
    console.log('📊 Current Status Distribution:');
    stats.forEach(stat => {
      console.log(`  ${stat.subscription_status || 'NULL'}: ${stat.count}`);
    });
    
    console.log('\n✅ All shopkeepers within 90-day trial are now set to "trial" status');
    console.log('💡 Use test-suspended-accounts.js only for creating fake test data');
    console.log('💡 For real shopkeepers, their status should be based on actual trial dates');
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

resetToTrial();
