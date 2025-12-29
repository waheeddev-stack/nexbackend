import 'dotenv/config';
import pool from '../config/db.js';

/**
 * Fix all shopkeeper statuses based on their ACTUAL creation dates
 * No fake data, no test data - just real dates
 */

async function fixAllStatusesByRealDates() {
  try {
    console.log('🔧 Fixing all shopkeeper statuses based on ACTUAL creation dates...\n');
    
    // First, reset trial_start_date to created_at for all shopkeepers
    console.log('Step 1: Setting trial_start_date = created_at for all shopkeepers...');
    const [resetResult] = await pool.query(`
      UPDATE shopkeepers
      SET trial_start_date = created_at
      WHERE id IS NOT NULL AND is_deleted = 0
    `);
    console.log(`✅ Updated ${resetResult.affectedRows} shopkeepers\n`);
    
    // Step 2: Set all shopkeepers to 'trial' status if they're within 90 days
    console.log('Step 2: Setting status to "trial" for shopkeepers within 90 days...');
    const [trialResult] = await pool.query(`
      UPDATE shopkeepers
      SET subscription_status = 'trial',
          next_payment_due = NULL,
          grace_period_end = NULL
      WHERE id IS NOT NULL 
        AND is_deleted = 0
        AND DATEDIFF(NOW(), COALESCE(created_at, NOW())) < 90
    `);
    console.log(`✅ Set ${trialResult.affectedRows} shopkeepers to trial status\n`);
    
    // Step 3: For shopkeepers past 90 days, set to 'active' with proper payment dates
    console.log('Step 3: Setting status to "active" for shopkeepers past 90 days...');
    const [activeResult] = await pool.query(`
      UPDATE shopkeepers
      SET subscription_status = 'active',
          next_payment_due = DATE_ADD(created_at, INTERVAL 105 DAY),
          grace_period_end = DATE_ADD(created_at, INTERVAL 107 DAY)
      WHERE id IS NOT NULL 
        AND is_deleted = 0
        AND DATEDIFF(NOW(), COALESCE(created_at, NOW())) >= 90
    `);
    console.log(`✅ Set ${activeResult.affectedRows} shopkeepers to active status\n`);
    
    // Show final status distribution
    const [stats] = await pool.query(`
      SELECT 
        subscription_status,
        COUNT(*) as count
      FROM shopkeepers
      WHERE id IS NOT NULL AND is_deleted = 0
      GROUP BY subscription_status
      ORDER BY count DESC
    `);
    
    console.log('📊 Final Status Distribution:');
    stats.forEach(stat => {
      console.log(`  ${stat.subscription_status || 'NULL'}: ${stat.count}`);
    });
    
    // Show some examples
    console.log('\n📋 Sample shopkeepers:');
    const [samples] = await pool.query(`
      SELECT 
        id, 
        name, 
        shop_name,
        created_at,
        subscription_status,
        DATEDIFF(NOW(), created_at) as days_old
      FROM shopkeepers
      WHERE id IS NOT NULL AND is_deleted = 0
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    samples.forEach(s => {
      console.log(`  ID ${s.id}: ${s.name} - ${s.days_old} days old - Status: ${s.subscription_status}`);
    });
    
    console.log('\n✅ All statuses fixed based on ACTUAL creation dates!');
    console.log('💡 No fake data, no test data - just real dates');
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

fixAllStatusesByRealDates();
