import pool from '../config/db.js';

const fixMissingTrialDates = async () => {
  try {
    console.log('🔧 Fixing missing trial_start_date for all shopkeepers...\n');
    console.log('=' .repeat(60));
    
    // Check current state
    console.log('📊 Checking current state...\n');
    const [beforeStats] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN trial_start_date IS NULL THEN 1 END) as missing,
        COUNT(CASE WHEN trial_start_date IS NOT NULL THEN 1 END) as has_date
      FROM shopkeepers 
      WHERE id IS NOT NULL AND is_deleted = 0
    `);
    
    console.log(`Total Shopkeepers: ${beforeStats[0].total}`);
    console.log(`Missing trial_start_date: ${beforeStats[0].missing}`);
    console.log(`Has trial_start_date: ${beforeStats[0].has_date}\n`);
    
    if (beforeStats[0].missing === 0) {
      console.log('✅ All shopkeepers already have trial_start_date!');
      console.log('   Nothing to fix.\n');
      process.exit(0);
    }
    
    // Show affected shopkeepers
    console.log('📋 Shopkeepers that will be updated:\n');
    const [affected] = await pool.query(`
      SELECT 
        id, 
        name, 
        email,
        is_verified,
        created_at,
        DATEDIFF(NOW(), created_at) as days_since_creation
      FROM shopkeepers 
      WHERE trial_start_date IS NULL
        AND id IS NOT NULL 
        AND is_deleted = 0
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    affected.forEach(shop => {
      const status = shop.is_verified === 1 ? '✅ Approved' : 
                     shop.is_verified === 0 ? '❌ Rejected' : '⏳ Pending';
      console.log(`   ID ${shop.id}: ${shop.name} ${status}`);
      console.log(`      Email: ${shop.email}`);
      console.log(`      Created: ${shop.created_at} (${shop.days_since_creation} days ago)`);
      console.log('');
    });
    
    if (affected.length < beforeStats[0].missing) {
      console.log(`   ... and ${beforeStats[0].missing - affected.length} more\n`);
    }
    
    // Apply fix - Use created_at as trial_start_date
    console.log('🔄 Applying fix...');
    console.log('   Setting trial_start_date = created_at for all shopkeepers');
    console.log('   This gives them trial from their signup date\n');
    
    const [result] = await pool.query(`
      UPDATE shopkeepers
      SET trial_start_date = created_at,
          subscription_status = CASE 
            WHEN is_verified = 1 THEN 'trial'
            ELSE subscription_status
          END
      WHERE trial_start_date IS NULL
        AND id IS NOT NULL 
        AND is_deleted = 0
    `);
    
    console.log(`✅ Updated ${result.affectedRows} shopkeeper(s)\n`);
    
    // Verify fix
    console.log('✔️  Verifying fix...\n');
    const [afterStats] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN trial_start_date IS NULL THEN 1 END) as missing,
        COUNT(CASE WHEN trial_start_date IS NOT NULL THEN 1 END) as has_date
      FROM shopkeepers 
      WHERE id IS NOT NULL AND is_deleted = 0
    `);
    
    console.log(`Total Shopkeepers: ${afterStats[0].total}`);
    console.log(`Missing trial_start_date: ${afterStats[0].missing}`);
    console.log(`Has trial_start_date: ${afterStats[0].has_date}\n`);
    
    if (afterStats[0].missing === 0) {
      console.log('🎉 SUCCESS! All shopkeepers now have trial_start_date!\n');
    } else {
      console.log(`⚠️  WARNING: ${afterStats[0].missing} shopkeepers still missing trial_start_date\n`);
    }
    
    // Show sample of updated records
    console.log('📋 Sample of updated records:\n');
    const [samples] = await pool.query(`
      SELECT 
        id, 
        name,
        is_verified,
        created_at,
        trial_start_date,
        subscription_status,
        DATEDIFF(NOW(), trial_start_date) as days_since_trial_start,
        DATEDIFF(DATE_ADD(trial_start_date, INTERVAL 90 DAY), NOW()) as trial_days_remaining
      FROM shopkeepers 
      WHERE trial_start_date IS NOT NULL
        AND id IS NOT NULL 
        AND is_deleted = 0
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    samples.forEach(shop => {
      const verifyStatus = shop.is_verified === 1 ? '✅ Approved' : 
                          shop.is_verified === 0 ? '❌ Rejected' : '⏳ Pending';
      const trialStatus = shop.trial_days_remaining > 0 ? 
        `✅ ${shop.trial_days_remaining} days left` : 
        `❌ Expired ${Math.abs(shop.trial_days_remaining)} days ago`;
      
      console.log(`   ID ${shop.id}: ${shop.name} ${verifyStatus}`);
      console.log(`      Created: ${shop.created_at}`);
      console.log(`      Trial Start: ${shop.trial_start_date}`);
      console.log(`      Trial Status: ${trialStatus}`);
      console.log(`      Subscription: ${shop.subscription_status || 'NULL'}`);
      console.log('');
    });
    
    console.log('=' .repeat(60));
    console.log('✅ Fix Complete!');
    console.log('=' .repeat(60));
    console.log('\n📝 What was done:');
    console.log('   ✅ Set trial_start_date = created_at for all shopkeepers');
    console.log('   ✅ Set subscription_status = "trial" for approved shopkeepers');
    console.log('   ✅ All shopkeepers now have valid trial dates');
    console.log('\n💡 Note:');
    console.log('   - Shopkeepers get 90-day trial from their signup date');
    console.log('   - Platform is still FREE (ENFORCE_SUBSCRIPTIONS=false)');
    console.log('   - No shopkeeper access is affected');
    console.log('   - Future approvals will set trial_start_date = NOW()');
    console.log('');
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error fixing trial dates:', err);
    console.error('Error details:', err.message);
    console.error('Stack:', err.stack);
    process.exit(1);
  }
};

fixMissingTrialDates();
