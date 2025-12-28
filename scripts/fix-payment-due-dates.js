import pool from '../config/db.js';

/**
 * Fix script to update all next_payment_due dates to use 15-day billing cycle
 * This corrects any shopkeepers that have 30-day payment cycles
 */

const fixPaymentDueDates = async () => {
  try {
    console.log('🔧 Fixing payment due dates to 15-day billing cycle...\n');

    // 1. Check current payment due dates
    console.log('📊 Checking current shopkeeper payment dates...');
    const [shopkeepers] = await pool.query(`
      SELECT 
        id, 
        name, 
        shop_name,
        subscription_status,
        trial_start_date,
        trial_end_date,
        last_payment_date,
        next_payment_due,
        grace_period_end,
        created_at
      FROM shopkeepers
      WHERE subscription_status IN ('active', 'overdue', 'suspended')
        AND next_payment_due IS NOT NULL
      ORDER BY next_payment_due
    `);

    console.log(`Found ${shopkeepers.length} shopkeeper(s) with payment due dates\n`);

    if (shopkeepers.length === 0) {
      console.log('✅ No shopkeepers need updating');
      process.exit(0);
    }

    // 2. Display current dates
    console.log('Current payment due dates:');
    shopkeepers.forEach(s => {
      const baseDate = s.last_payment_date || s.trial_end_date || s.created_at;
      const daysDiff = Math.ceil((new Date(s.next_payment_due) - new Date(baseDate)) / (1000 * 60 * 60 * 24));
      console.log(`  - ${s.name} (${s.shop_name}): ${daysDiff} days from base date`);
    });

    // 3. Update all payment due dates to 15-day cycle
    console.log('\n🔄 Updating to 15-day billing cycle...');
    
    const [result] = await pool.query(`
      UPDATE shopkeepers 
      SET 
        next_payment_due = DATE_ADD(
          COALESCE(last_payment_date, trial_end_date, created_at), 
          INTERVAL 15 DAY
        ),
        grace_period_end = DATE_ADD(
          COALESCE(last_payment_date, trial_end_date, created_at), 
          INTERVAL 17 DAY
        )
      WHERE subscription_status IN ('active', 'overdue', 'suspended')
        AND next_payment_due IS NOT NULL
    `);

    console.log(`✅ Updated ${result.affectedRows} shopkeeper(s)\n`);

    // 4. Verify the changes
    console.log('🔍 Verifying updated dates...');
    const [updated] = await pool.query(`
      SELECT 
        id, 
        name, 
        shop_name,
        subscription_status,
        last_payment_date,
        trial_end_date,
        next_payment_due,
        grace_period_end,
        created_at,
        DATEDIFF(
          next_payment_due, 
          COALESCE(last_payment_date, trial_end_date, created_at)
        ) as days_until_due
      FROM shopkeepers
      WHERE subscription_status IN ('active', 'overdue', 'suspended')
        AND next_payment_due IS NOT NULL
      ORDER BY next_payment_due
    `);

    console.log('\nUpdated payment due dates:');
    updated.forEach(s => {
      console.log(`  - ${s.name} (${s.shop_name}): ${s.days_until_due} days (${s.subscription_status})`);
    });

    // 5. Summary
    console.log('\n📊 Summary:');
    console.log(`   ✅ ${result.affectedRows} shopkeeper(s) updated to 15-day billing cycle`);
    console.log('   ✅ Grace period set to 17 days (15 + 2)');
    console.log('\n🎉 Payment due dates fixed!');
    console.log('\n📝 Next steps:');
    console.log('   1. Refresh your admin panel');
    console.log('   2. Verify next payment due dates show 15 days (not 30)');
    console.log('   3. Future payment approvals will automatically use 15-day cycle');

    process.exit(0);
  } catch (err) {
    console.error('❌ Error fixing payment due dates:', err);
    console.error('Error details:', err.message);
    process.exit(1);
  }
};

fixPaymentDueDates();
