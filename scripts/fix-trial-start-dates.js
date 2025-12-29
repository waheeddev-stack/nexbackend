import pool from '../config/db.js';

const fixTrialStartDates = async () => {
  try {
    console.log('🔧 Fixing trial_start_date for approved shopkeepers...\n');
    console.log('=' .repeat(60));
    
    // Step 1: Check current state
    console.log('\n📊 Step 1: Checking current state...');
    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) as total_approved,
        COUNT(CASE WHEN trial_start_date IS NULL THEN 1 END) as missing_trial_date,
        COUNT(CASE WHEN trial_start_date IS NOT NULL THEN 1 END) as has_trial_date
      FROM shopkeepers 
      WHERE is_verified = 1 
        AND id IS NOT NULL 
        AND is_deleted = 0
    `);
    
    console.log(`   Total Approved Shopkeepers: ${stats[0].total_approved}`);
    console.log(`   Missing trial_start_date: ${stats[0].missing_trial_date}`);
    console.log(`   Has trial_start_date: ${stats[0].has_trial_date}`);
    
    if (stats[0].missing_trial_date === 0) {
      console.log('\n✅ All approved shopkeepers already have trial_start_date set!');
      console.log('   No migration needed.');
      process.exit(0);
    }
    
    // Step 2: Show affected shopkeepers
    console.log('\n📋 Step 2: Shopkeepers that will be updated:');
    const [affected] = await pool.query(`
      SELECT 
        id, 
        name, 
        shop_name,
        email,
        created_at,
        DATEDIFF(NOW(), created_at) as days_since_creation
      FROM shopkeepers 
      WHERE is_verified = 1 
        AND trial_start_date IS NULL
        AND id IS NOT NULL 
        AND is_deleted = 0
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    affected.forEach(shop => {
      console.log(`   - ID ${shop.id}: ${shop.name} (${shop.shop_name})`);
      console.log(`     Created: ${shop.created_at} (${shop.days_since_creation} days ago)`);
    });
    
    if (affected.length === stats[0].missing_trial_date) {
      console.log(`   ... and ${affected.length} more`);
    }
    
    // Step 3: Apply fix
    console.log('\n🔄 Step 3: Applying fix...');
    console.log('   Setting trial_start_date = created_at for approved shopkeepers');
    console.log('   This maintains their original trial period from signup');
    
    const [result] = await pool.query(`
      UPDATE shopkeepers
      SET trial_start_date = created_at,
          subscription_status = 'trial'
      WHERE is_verified = 1 
        AND trial_start_date IS NULL
        AND id IS NOT NULL 
        AND is_deleted = 0
    `);
    
    console.log(`   ✅ Updated ${result.affectedRows} shopkeeper(s)`);
    
    // Step 4: Verify fix
    console.log('\n✔️  Step 4: Verifying fix...');
    const [verification] = await pool.query(`
      SELECT 
        COUNT(*) as total_approved,
        COUNT(CASE WHEN trial_start_date IS NULL THEN 1 END) as missing_trial_date,
        COUNT(CASE WHEN trial_start_date IS NOT NULL THEN 1 END) as has_trial_date
      FROM shopkeepers 
      WHERE is_verified = 1 
        AND id IS NOT NULL 
        AND is_deleted = 0
    `);
    
    console.log(`   Total Approved: ${verification[0].total_approved}`);
    console.log(`   Missing trial_start_date: ${verification[0].missing_trial_date}`);
    console.log(`   Has trial_start_date: ${verification[0].has_trial_date}`);
    
    if (verification[0].missing_trial_date === 0) {
      console.log('\n🎉 SUCCESS! All approved shopkeepers now have trial_start_date set!');
    } else {
      console.log(`\n⚠️  WARNING: ${verification[0].missing_trial_date} shopkeepers still missing trial_start_date`);
    }
    
    // Step 5: Show sample of updated records
    console.log('\n📋 Step 5: Sample of updated records:');
    const [samples] = await pool.query(`
      SELECT 
        id, 
        name, 
        trial_start_date,
        subscription_status,
        DATEDIFF(NOW(), trial_start_date) as days_since_trial_start,
        DATEDIFF(DATE_ADD(trial_start_date, INTERVAL 90 DAY), NOW()) as trial_days_remaining
      FROM shopkeepers 
      WHERE is_verified = 1 
        AND trial_start_date IS NOT NULL
        AND id IS NOT NULL 
        AND is_deleted = 0
      ORDER BY trial_start_date DESC
      LIMIT 5
    `);
    
    samples.forEach(shop => {
      const status = shop.trial_days_remaining > 0 ? '✅ ACTIVE' : '❌ EXPIRED';
      console.log(`   - ID ${shop.id}: ${shop.name}`);
      console.log(`     Trial Start: ${shop.trial_start_date}`);
      console.log(`     Days Since Start: ${shop.days_since_trial_start}`);
      console.log(`     Days Remaining: ${shop.trial_days_remaining} ${status}`);
      console.log(`     Status: ${shop.subscription_status}`);
      console.log('');
    });
    
    console.log('=' .repeat(60));
    console.log('✅ Migration Complete!');
    console.log('=' .repeat(60));
    console.log('\n📝 Next Steps:');
    console.log('   1. Restart your backend server');
    console.log('   2. Test admin approval flow with a new shopkeeper');
    console.log('   3. Verify trial_start_date is set automatically on approval');
    console.log('   4. Check subscription enforcement (if enabled)');
    console.log('\n💡 Note: Future approvals will automatically set trial_start_date');
    console.log('');
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error fixing trial start dates:', err);
    console.error('Error details:', err.message);
    console.error('Stack:', err.stack);
    process.exit(1);
  }
};

fixTrialStartDates();
