import pool from '../config/db.js';

async function fixSubscriptionStatus() {
  let connection;
  
  try {
    console.log('🔧 Starting subscription status fix...\n');
    
    connection = await pool.getConnection();
    
    // Step 1: Check current state
    console.log('📊 Step 1: Checking current state...');
    const [currentStatus] = await connection.execute(`
      SELECT 
        subscription_status,
        COUNT(*) as count
      FROM shopkeepers
      GROUP BY subscription_status
    `);
    
    console.log('Current status distribution:');
    console.table(currentStatus);
    
    // Step 2: Check column definition
    console.log('\n📋 Step 2: Checking column definition...');
    const [columns] = await connection.execute(`
      SHOW COLUMNS FROM shopkeepers LIKE 'subscription_status'
    `);
    console.log('Current column definition:');
    console.table(columns);
    
    // Step 3: Modify ENUM to include all valid values
    console.log('\n🔨 Step 3: Updating ENUM definition...');
    try {
      await connection.execute(`
        ALTER TABLE shopkeepers 
        MODIFY COLUMN subscription_status 
        ENUM('active', 'overdue', 'grace_period', 'suspended') 
        DEFAULT 'active'
      `);
      console.log('✅ ENUM updated successfully');
    } catch (error) {
      if (error.message.includes('Duplicate')) {
        console.log('⚠️ ENUM already has correct values');
      } else {
        throw error;
      }
    }
    
    // Step 4: Migrate 'trial' to 'active'
    console.log('\n🔄 Step 4: Migrating trial status to active...');
    const [trialResult] = await connection.execute(`
      UPDATE shopkeepers 
      SET subscription_status = 'active' 
      WHERE subscription_status = 'trial'
    `);
    console.log(`✅ Migrated ${trialResult.affectedRows} shopkeepers from trial to active`);
    
    // Step 5: Fix NULL values
    console.log('\n🔄 Step 5: Fixing NULL values...');
    const [nullResult] = await connection.execute(`
      UPDATE shopkeepers 
      SET subscription_status = 'active' 
      WHERE subscription_status IS NULL
    `);
    console.log(`✅ Fixed ${nullResult.affectedRows} NULL values`);
    
    // Step 6: Fix any other invalid values
    console.log('\n🔄 Step 6: Fixing invalid values...');
    const [invalidResult] = await connection.execute(`
      UPDATE shopkeepers 
      SET subscription_status = 'active'
      WHERE subscription_status NOT IN ('active', 'overdue', 'grace_period', 'suspended')
    `);
    console.log(`✅ Fixed ${invalidResult.affectedRows} invalid values`);
    
    // Step 7: Verify the fix
    console.log('\n✅ Step 7: Verifying the fix...');
    const [newStatus] = await connection.execute(`
      SELECT 
        subscription_status,
        COUNT(*) as count
      FROM shopkeepers
      GROUP BY subscription_status
    `);
    
    console.log('New status distribution:');
    console.table(newStatus);
    
    // Step 8: Check column definition again
    const [newColumns] = await connection.execute(`
      SHOW COLUMNS FROM shopkeepers LIKE 'subscription_status'
    `);
    console.log('\nNew column definition:');
    console.table(newColumns);
    
    // Step 9: Show sample shopkeepers
    console.log('\n📋 Sample shopkeepers:');
    const [shopkeepers] = await connection.execute(`
      SELECT 
        id, 
        name, 
        email, 
        subscription_status, 
        is_verified
      FROM shopkeepers
      ORDER BY id
      LIMIT 10
    `);
    console.table(shopkeepers);
    
    console.log('\n🎉 Subscription status fix completed successfully!');
    console.log('\n📝 Summary:');
    console.log(`   - Trial migrations: ${trialResult.affectedRows}`);
    console.log(`   - NULL fixes: ${nullResult.affectedRows}`);
    console.log(`   - Invalid value fixes: ${invalidResult.affectedRows}`);
    console.log(`   - Total affected: ${trialResult.affectedRows + nullResult.affectedRows + invalidResult.affectedRows}`);
    
    console.log('\n✅ Next steps:');
    console.log('   1. Test suspend/unsuspend from admin panel');
    console.log('   2. Verify shopkeeper app blocks suspended accounts');
    console.log('   3. Check that unsuspend button appears for suspended shopkeepers');
    
  } catch (error) {
    console.error('\n❌ Error fixing subscription status:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    if (connection) {
      connection.release();
    }
    await pool.end();
  }
}

// Run the fix
fixSubscriptionStatus();
