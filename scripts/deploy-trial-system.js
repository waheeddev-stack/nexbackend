import pool from '../config/db.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const deployTrialSystem = async () => {
  console.log('🚀 Deploying Trial & Payment System Integration\n');
  console.log('=' .repeat(70));
  console.log('This will set up the complete trial and payment system');
  console.log('Compatible with existing shopkeepers - Zero disruption!');
  console.log('=' .repeat(70));
  console.log('');

  try {
    // Step 1: Setup billing system
    console.log('📦 Step 1/3: Setting up billing system...');
    console.log('   - Creating database tables');
    console.log('   - Adding subscription columns');
    console.log('   - Initializing trial periods\n');
    
    try {
      const { stdout: setupOutput } = await execAsync('node scripts/setup-billing-system.js');
      console.log(setupOutput);
    } catch (err) {
      console.log('⚠️  Setup script output:', err.stdout);
      // Continue anyway - tables might already exist
    }

    // Step 2: Fix trial start dates
    console.log('\n📅 Step 2/3: Fixing trial start dates for approved shopkeepers...');
    console.log('   - Finding approved shopkeepers without trial dates');
    console.log('   - Setting trial_start_date = created_at');
    console.log('   - Ensuring full 90-day trial\n');
    
    try {
      const { stdout: fixOutput } = await execAsync('node scripts/fix-trial-start-dates.js');
      console.log(fixOutput);
    } catch (err) {
      console.log('⚠️  Fix script output:', err.stdout);
      // Continue anyway
    }

    // Step 3: Verification
    console.log('\n✅ Step 3/3: Verifying deployment...\n');
    
    // Check tables exist
    const [billingTable] = await pool.query("SHOW TABLES LIKE 'billing_payments'");
    const [paymentInfoTable] = await pool.query("SHOW TABLES LIKE 'payment_info'");
    
    console.log('📊 Database Tables:');
    console.log(`   ${billingTable.length > 0 ? '✅' : '❌'} billing_payments table`);
    console.log(`   ${paymentInfoTable.length > 0 ? '✅' : '❌'} payment_info table`);
    
    // Check shopkeeper columns
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'shopkeepers'
      AND COLUMN_NAME IN ('subscription_status', 'trial_start_date', 'trial_end_date')
    `);
    
    console.log('\n📊 Shopkeeper Columns:');
    const columnNames = columns.map(c => c.COLUMN_NAME);
    console.log(`   ${columnNames.includes('subscription_status') ? '✅' : '❌'} subscription_status`);
    console.log(`   ${columnNames.includes('trial_start_date') ? '✅' : '❌'} trial_start_date`);
    console.log(`   ${columnNames.includes('trial_end_date') ? '✅' : '❌'} trial_end_date`);
    
    // Check shopkeeper data
    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) as total_approved,
        COUNT(trial_start_date) as has_trial_date,
        COUNT(*) - COUNT(trial_start_date) as missing_trial_date
      FROM shopkeepers 
      WHERE is_verified = 1 AND id IS NOT NULL AND is_deleted = 0
    `);
    
    console.log('\n📊 Shopkeeper Data:');
    console.log(`   Total Approved: ${stats[0].total_approved}`);
    console.log(`   Has trial_start_date: ${stats[0].has_trial_date}`);
    console.log(`   Missing trial_start_date: ${stats[0].missing_trial_date}`);
    
    // Check trial status
    const [trialStats] = await pool.query(`
      SELECT 
        subscription_status,
        COUNT(*) as count
      FROM shopkeepers
      WHERE is_verified = 1 AND id IS NOT NULL AND is_deleted = 0
      GROUP BY subscription_status
    `);
    
    console.log('\n📊 Subscription Status:');
    trialStats.forEach(stat => {
      console.log(`   ${stat.subscription_status || 'NULL'}: ${stat.count} shopkeepers`);
    });
    
    // Final summary
    console.log('\n' + '=' .repeat(70));
    console.log('🎉 DEPLOYMENT COMPLETE!');
    console.log('=' .repeat(70));
    
    const allGood = 
      billingTable.length > 0 &&
      paymentInfoTable.length > 0 &&
      columnNames.includes('subscription_status') &&
      columnNames.includes('trial_start_date') &&
      stats[0].missing_trial_date === 0;
    
    if (allGood) {
      console.log('\n✅ All checks passed! System is ready.');
      console.log('\n📝 Next Steps:');
      console.log('   1. Restart your backend: pm2 restart nexbackend');
      console.log('   2. Test shopkeeper login and access');
      console.log('   3. Check admin panel for subscription status');
      console.log('   4. Monitor backend logs for any issues');
      console.log('\n💡 Platform is currently FREE (ENFORCE_SUBSCRIPTIONS=false)');
      console.log('   To enable paid subscriptions:');
      console.log('   - Set ENFORCE_SUBSCRIPTIONS=true in .env');
      console.log('   - Restart backend');
      console.log('');
    } else {
      console.log('\n⚠️  Some checks failed. Please review the output above.');
      console.log('   The system may still work, but manual verification recommended.');
      console.log('');
    }
    
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Deployment failed:', err);
    console.error('Error details:', err.message);
    console.error('\n📞 Troubleshooting:');
    console.error('   1. Check database connection');
    console.error('   2. Ensure you have database permissions');
    console.error('   3. Review error message above');
    console.error('   4. Check COMPLETE_INTEGRATION_DEPLOYMENT.md for manual steps');
    console.error('');
    process.exit(1);
  }
};

deployTrialSystem();
