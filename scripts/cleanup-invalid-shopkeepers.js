import 'dotenv/config';
import pool from '../config/db.js';

async function cleanupInvalidShopkeepers() {
  try {
    console.log('🧹 Cleaning up invalid shopkeeper records...\n');
    
    // 1. Check for shopkeepers with NULL IDs
    const [nullIdShopkeepers] = await pool.query(`
      SELECT COUNT(*) as count FROM shopkeepers WHERE id IS NULL
    `);
    console.log(`Found ${nullIdShopkeepers[0].count} shopkeepers with NULL IDs`);
    
    if (nullIdShopkeepers[0].count > 0) {
      // Delete shopkeepers with NULL IDs
      const [deleteResult] = await pool.query(`
        DELETE FROM shopkeepers WHERE id IS NULL
      `);
      console.log(`✅ Deleted ${deleteResult.affectedRows} shopkeepers with NULL IDs\n`);
    }
    
    // 2. Check for shopkeepers with 'free' status
    const [freeStatusShopkeepers] = await pool.query(`
      SELECT id, name, shop_name, subscription_status 
      FROM shopkeepers 
      WHERE subscription_status = 'free'
      LIMIT 10
    `);
    console.log(`Found ${freeStatusShopkeepers.length} shopkeepers with 'free' status`);
    
    if (freeStatusShopkeepers.length > 0) {
      console.log('Converting to "trial" status:');
      freeStatusShopkeepers.forEach(s => {
        console.log(`  - ${s.id}: ${s.name} (${s.shop_name})`);
      });
      
      // Convert 'free' to 'trial'
      const [updateResult] = await pool.query(`
        UPDATE shopkeepers 
        SET subscription_status = 'trial' 
        WHERE subscription_status = 'free'
      `);
      console.log(`✅ Converted ${updateResult.affectedRows} shopkeepers from 'free' to 'trial'\n`);
    }
    
    // 3. Check for shopkeepers with NULL subscription_status
    const [nullStatusShopkeepers] = await pool.query(`
      SELECT COUNT(*) as count 
      FROM shopkeepers 
      WHERE subscription_status IS NULL AND id IS NOT NULL
    `);
    console.log(`Found ${nullStatusShopkeepers[0].count} shopkeepers with NULL subscription_status`);
    
    if (nullStatusShopkeepers[0].count > 0) {
      // Set NULL status to 'trial'
      const [updateResult] = await pool.query(`
        UPDATE shopkeepers 
        SET subscription_status = 'trial' 
        WHERE subscription_status IS NULL AND id IS NOT NULL
      `);
      console.log(`✅ Set ${updateResult.affectedRows} shopkeepers to 'trial' status\n`);
    }
    
    // 4. Show final status distribution
    const [finalStats] = await pool.query(`
      SELECT 
        subscription_status,
        COUNT(*) as count
      FROM shopkeepers
      WHERE id IS NOT NULL AND is_deleted = 0
      GROUP BY subscription_status
      ORDER BY count DESC
    `);
    
    console.log('📊 Final Status Distribution:');
    finalStats.forEach(stat => {
      console.log(`  ${stat.subscription_status || 'NULL'}: ${stat.count}`);
    });
    
    console.log('\n🎉 Cleanup complete!');
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

cleanupInvalidShopkeepers();
