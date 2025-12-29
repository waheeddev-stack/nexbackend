import pool from '../config/db.js';

const fixNullCreatedAt = async () => {
  try {
    console.log('🔧 Fixing NULL created_at and trial_start_date...\n');
    console.log('=' .repeat(60));
    
    // Check shopkeepers with NULL created_at
    console.log('📊 Checking shopkeepers with NULL created_at...\n');
    const [nullCreated] = await pool.query(`
      SELECT 
        COUNT(*) as total_null_created,
        COUNT(CASE WHEN is_verified = 1 THEN 1 END) as approved_null_created
      FROM shopkeepers 
      WHERE created_at IS NULL AND id IS NOT NULL AND is_deleted = 0
    `);
    
    console.log(`Shopkeepers with NULL created_at: ${nullCreated[0].total_null_created}`);
    console.log(`  - Approved: ${nullCreated[0].approved_null_created}\n`);
    
    // Check shopkeepers with NULL trial_start_date
    const [nullTrial] = await pool.query(`
      SELECT 
        COUNT(*) as total_null_trial,
        COUNT(CASE WHEN is_verified = 1 THEN 1 END) as approved_null_trial
      FROM shopkeepers 
      WHERE trial_start_date IS NULL AND id IS NOT NULL AND is_deleted = 0
    `);
    
    console.log(`Shopkeepers with NULL trial_start_date: ${nullTrial[0].total_null_trial}`);
    console.log(`  - Approved: ${nullTrial[0].approved_null_trial}\n`);
    
    // Show sample of affected shopkeepers
    console.log('📋 Sample of affected shopkeepers:\n');
    const [sample] = await pool.query(`
      SELECT id, name, email, is_verified, created_at, trial_start_date
      FROM shopkeepers 
      WHERE (created_at IS NULL OR trial_start_date IS NULL)
        AND id IS NOT NULL 
        AND is_deleted = 0
      ORDER BY id DESC
      LIMIT 10
    `);
    
    sample.forEach(shop => {
      const status = shop.is_verified === 1 ? '✅ Approved' : 
                     shop.is_verified === 0 ? '❌ Rejected' : '⏳ Pending';
      console.log(`   ID ${shop.id}: ${shop.name} ${status}`);
      console.log(`      Email: ${shop.email}`);
      console.log(`      created_at: ${shop.created_at || 'NULL ❌'}`);
      console.log(`      trial_start_date: ${shop.trial_start_date || 'NULL ❌'}`);
      console.log('');
    });
    
    // Fix 1: Set created_at = NOW() for shopkeepers with NULL created_at
    console.log('🔄 Fix 1: Setting created_at = NOW() for shopkeepers with NULL created_at...\n');
    const [result1] = await pool.query(`
      UPDATE shopkeepers
      SET created_at = NOW()
      WHERE created_at IS NULL
        AND id IS NOT NULL 
        AND is_deleted = 0
    `);
    console.log(`✅ Updated created_at for ${result1.affectedRows} shopkeeper(s)\n`);
    
    // Fix 2: Set trial_start_date = created_at for shopkeepers with NULL trial_start_date
    console.log('🔄 Fix 2: Setting trial_start_date = created_at for shopkeepers with NULL trial_start_date...\n');
    const [result2] = await pool.query(`
      UPDATE shopkeepers
      SET trial_start_date = created_at,
          subscription_status = CASE 
            WHEN is_verified = 1 THEN 'trial'
            ELSE subscription_status
          END
      WHERE trial_start_date IS NULL
        AND created_at IS NOT NULL
        AND id IS NOT NULL 
        AND is_deleted = 0
    `);
    console.log(`✅ Updated trial_start_date for ${result2.affectedRows} shopkeeper(s)\n`);
    
    // Verify fix
    console.log('✔️  Verifying fix...\n');
    const [afterStats] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN created_at IS NULL THEN 1 END) as null_created,
        COUNT(CASE WHEN trial_start_date IS NULL THEN 1 END) as null_trial,
        COUNT(CASE WHEN created_at IS NOT NULL AND trial_start_date IS NOT NULL THEN 1 END) as both_set
      FROM shopkeepers 
      WHERE id IS NOT NULL AND is_deleted = 0
    `);
    
    console.log(`Total Shopkeepers: ${afterStats[0].total}`);
    console.log(`NULL created_at: ${afterStats[0].null_created}`);
    console.log(`NULL trial_start_date: ${afterStats[0].null_trial}`);
    console.log(`Both set: ${afterStats[0].both_set}\n`);
    
    if (afterStats[0].null_created === 0 && afterStats[0].null_trial === 0) {
      console.log('🎉 SUCCESS! All shopkeepers now have created_at and trial_start_date!\n');
    } else {
      console.log(`⚠️  WARNING: Still have NULL values\n`);
    }
    
    // Show sample of fixed records
    console.log('📋 Sample of fixed records:\n');
    const [fixedSample] = await pool.query(`
      SELECT 
        id, 
        name,
        is_verified,
        created_at,
        trial_start_date,
        subscription_status,
        DATEDIFF(DATE_ADD(trial_start_date, INTERVAL 90 DAY), NOW()) as trial_days_remaining
      FROM shopkeepers 
      WHERE created_at IS NOT NULL 
        AND trial_start_date IS NOT NULL
        AND id IS NOT NULL 
        AND is_deleted = 0
      ORDER BY id DESC
      LIMIT 5
    `);
    
    fixedSample.forEach(shop => {
      const verifyStatus = shop.is_verified === 1 ? '✅ Approved' : 
                          shop.is_verified === 0 ? '❌ Rejected' : '⏳ Pending';
      const trialStatus = shop.trial_days_remaining > 0 ? 
        `✅ ${shop.trial_days_remaining} days left` : 
        `❌ Expired ${Math.abs(shop.trial_days_remaining)} days ago`;
      
      console.log(`   ID ${shop.id}: ${shop.name} ${verifyStatus}`);
      console.log(`      created_at: ${shop.created_at}`);
      console.log(`      trial_start_date: ${shop.trial_start_date}`);
      console.log(`      Trial Status: ${trialStatus}`);
      console.log(`      Subscription: ${shop.subscription_status || 'NULL'}`);
      console.log('');
    });
    
    console.log('=' .repeat(60));
    console.log('✅ Fix Complete!');
    console.log('=' .repeat(60));
    console.log('\n📝 What was done:');
    console.log('   ✅ Set created_at = NOW() for shopkeepers with NULL created_at');
    console.log('   ✅ Set trial_start_date = created_at for all shopkeepers');
    console.log('   ✅ Set subscription_status = "trial" for approved shopkeepers');
    console.log('\n💡 Note:');
    console.log('   - Shopkeepers with NULL created_at now have current date');
    console.log('   - All shopkeepers now have valid trial dates');
    console.log('   - Platform is still FREE (ENFORCE_SUBSCRIPTIONS=false)');
    console.log('   - No shopkeeper access is affected');
    console.log('');
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error fixing NULL values:', err);
    console.error('Error details:', err.message);
    console.error('Stack:', err.stack);
    process.exit(1);
  }
};

fixNullCreatedAt();
