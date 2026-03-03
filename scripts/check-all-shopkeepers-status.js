import pool from '../config/db.js';

async function checkAllShopkeepersStatus() {
  let connection;
  
  try {
    connection = await pool.getConnection();
    
    console.log('🔍 CHECKING ALL SHOPKEEPERS STATUS\n');
    console.log('=' .repeat(80));
    
    // Get all shopkeepers with their status
    const [allShopkeepers] = await connection.execute(`
      SELECT 
        id, 
        name, 
        email, 
        subscription_status, 
        is_verified,
        is_deleted,
        created_at
      FROM shopkeepers 
      WHERE is_deleted = 0
      ORDER BY subscription_status, id
    `);
    
    console.log(`\n📊 Total shopkeepers (not deleted): ${allShopkeepers.length}\n`);
    
    // Group by subscription status
    const statusGroups = {
      active: [],
      suspended: [],
      grace_period: [],
      overdue: [],
      other: []
    };
    
    allShopkeepers.forEach(s => {
      const status = s.subscription_status || 'null';
      if (statusGroups[status]) {
        statusGroups[status].push(s);
      } else {
        statusGroups.other.push(s);
      }
    });
    
    // Display summary
    console.log('📈 STATUS SUMMARY:\n');
    console.table([
      { Status: 'active', Count: statusGroups.active.length },
      { Status: 'suspended', Count: statusGroups.suspended.length },
      { Status: 'grace_period', Count: statusGroups.grace_period.length },
      { Status: 'overdue', Count: statusGroups.overdue.length },
      { Status: 'other/null', Count: statusGroups.other.length }
    ]);
    
    // Show suspended shopkeepers in detail
    if (statusGroups.suspended.length > 0) {
      console.log('\n\n🚫 SUSPENDED SHOPKEEPERS:\n');
      console.table(statusGroups.suspended.map(s => ({
        ID: s.id,
        Name: s.name,
        Email: s.email,
        Verified: s.is_verified,
        Status: s.subscription_status
      })));
    } else {
      console.log('\n\n✅ No suspended shopkeepers found\n');
    }
    
    // Show grace period shopkeepers
    if (statusGroups.grace_period.length > 0) {
      console.log('\n\n⚠️  GRACE PERIOD SHOPKEEPERS:\n');
      console.table(statusGroups.grace_period.map(s => ({
        ID: s.id,
        Name: s.name,
        Email: s.email,
        Verified: s.is_verified,
        Status: s.subscription_status
      })));
    }
    
    // Show overdue shopkeepers
    if (statusGroups.overdue.length > 0) {
      console.log('\n\n⏰ OVERDUE SHOPKEEPERS:\n');
      console.table(statusGroups.overdue.map(s => ({
        ID: s.id,
        Name: s.name,
        Email: s.email,
        Verified: s.is_verified,
        Status: s.subscription_status
      })));
    }
    
    // Show shopkeepers with NULL or invalid status
    if (statusGroups.other.length > 0) {
      console.log('\n\n❓ SHOPKEEPERS WITH NULL/INVALID STATUS:\n');
      console.table(statusGroups.other.map(s => ({
        ID: s.id,
        Name: s.name,
        Email: s.email,
        Verified: s.is_verified,
        Status: s.subscription_status || 'NULL'
      })));
      console.log('\n⚠️  These shopkeepers should be fixed to have "active" status\n');
    }
    
    // Check verification status distribution
    console.log('\n\n📋 VERIFICATION STATUS DISTRIBUTION:\n');
    const verificationGroups = {
      verified: allShopkeepers.filter(s => s.is_verified === 1),
      rejected: allShopkeepers.filter(s => s.is_verified === 0),
      pending: allShopkeepers.filter(s => s.is_verified === null || s.is_verified === '')
    };
    
    console.table([
      { Verification: 'Verified (is_verified=1)', Count: verificationGroups.verified.length },
      { Verification: 'Rejected (is_verified=0)', Count: verificationGroups.rejected.length },
      { Verification: 'Pending (is_verified=NULL)', Count: verificationGroups.pending.length }
    ]);
    
    // Check for potential issues
    console.log('\n\n⚠️  POTENTIAL ISSUES:\n');
    
    let issuesFound = false;
    
    // Issue 1: Suspended but not verified
    const suspendedNotVerified = statusGroups.suspended.filter(s => s.is_verified !== 1);
    if (suspendedNotVerified.length > 0) {
      issuesFound = true;
      console.log(`❌ ${suspendedNotVerified.length} suspended shopkeeper(s) are NOT verified:`);
      suspendedNotVerified.forEach(s => {
        console.log(`   - ID ${s.id}: ${s.name} (${s.email})`);
      });
      console.log('   → These will NOT show unsuspend button in admin panel!\n');
    }
    
    // Issue 2: NULL subscription status
    if (statusGroups.other.length > 0) {
      issuesFound = true;
      console.log(`❌ ${statusGroups.other.length} shopkeeper(s) have NULL/invalid subscription_status`);
      console.log('   → These should be set to "active"\n');
    }
    
    if (!issuesFound) {
      console.log('✅ No issues found!\n');
    }
    
    // Admin panel expectations
    console.log('\n\n🎛️  ADMIN PANEL EXPECTATIONS:\n');
    console.log('=' .repeat(80));
    
    const verifiedSuspended = statusGroups.suspended.filter(s => s.is_verified === 1);
    const verifiedActive = statusGroups.active.filter(s => s.is_verified === 1);
    
    console.log(`\n✅ Shopkeepers that SHOULD show UNSUSPEND button: ${verifiedSuspended.length}`);
    if (verifiedSuspended.length > 0) {
      verifiedSuspended.forEach(s => {
        console.log(`   - ID ${s.id}: ${s.name} (${s.email})`);
      });
    }
    
    console.log(`\n✅ Shopkeepers that SHOULD show SUSPEND button: ${verifiedActive.length}`);
    console.log('   (Only showing first 5)');
    verifiedActive.slice(0, 5).forEach(s => {
      console.log(`   - ID ${s.id}: ${s.name} (${s.email})`);
    });
    
    console.log(`\n❌ Shopkeepers that should NOT show any suspend/unsuspend buttons: ${verificationGroups.rejected.length + verificationGroups.pending.length}`);
    console.log('   (Not verified or rejected)\n');
    
    // Recommendations
    console.log('\n\n💡 RECOMMENDATIONS:\n');
    console.log('=' .repeat(80));
    
    if (statusGroups.suspended.length === 1) {
      console.log('\n✅ Only 1 shopkeeper is suspended (correct)');
      console.log('   If admin panel shows more, it\'s a frontend caching issue.');
      console.log('   Solution: Hard refresh admin panel (Ctrl+Shift+R)\n');
    } else if (statusGroups.suspended.length > 1) {
      console.log(`\n⚠️  ${statusGroups.suspended.length} shopkeepers are suspended`);
      console.log('   If this is unexpected, you can unsuspend them from admin panel\n');
    } else {
      console.log('\n✅ No shopkeepers are suspended');
      console.log('   This is normal if you haven\'t suspended anyone yet\n');
    }
    
    if (statusGroups.other.length > 0) {
      console.log('⚠️  Fix NULL/invalid subscription_status:');
      console.log('   Run: node scripts/fix-subscription-status.js\n');
    }
    
    console.log('\n' + '=' .repeat(80));
    console.log('✅ CHECK COMPLETE\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    if (connection) {
      connection.release();
    }
    await pool.end();
  }
}

checkAllShopkeepersStatus();
