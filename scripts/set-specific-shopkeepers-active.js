import 'dotenv/config';
import pool from '../config/db.js';

async function setSpecificShopkeepersActive() {
  try {
    console.log('🔧 Setting specific shopkeepers to active status...\n');

    // 1. Set shopkeepers with NULL created_at/trial_start_date to active
    console.log('Step 1: Setting shopkeepers with NULL dates to active...');
    const [nullDateResult] = await pool.query(`
      UPDATE shopkeepers
      SET subscription_status = 'active',
          trial_start_date = DATE_SUB(NOW(), INTERVAL 100 DAY),
          next_payment_due = DATE_ADD(NOW(), INTERVAL 10 DAY)
      WHERE id IS NOT NULL 
        AND is_deleted = 0
        AND (created_at IS NULL OR trial_start_date IS NULL)
    `);
    console.log(`✅ Set ${nullDateResult.affectedRows} shopkeepers with NULL dates to active\n`);

    // 2. Set specific shopkeepers by name to active
    console.log('Step 2: Setting "Waheed Nexkirana" and "waheed" to active...');
    
    // Find these shopkeepers first
    const [waheedShopkeepers] = await pool.query(`
      SELECT id, name, shop_name, subscription_status
      FROM shopkeepers
      WHERE (name LIKE '%Waheed%' OR name LIKE '%waheed%')
        AND id IS NOT NULL
        AND is_deleted = 0
    `);
    
    console.log(`Found ${waheedShopkeepers.length} shopkeepers matching "Waheed":`);
    waheedShopkeepers.forEach(s => {
      console.log(`  - ID ${s.id}: ${s.name} (${s.shop_name}) - Current: ${s.subscription_status}`);
    });
    console.log('');
    
    // Update them to active
    const [waheedResult] = await pool.query(`
      UPDATE shopkeepers
      SET subscription_status = 'active',
          trial_start_date = DATE_SUB(NOW(), INTERVAL 100 DAY),
          next_payment_due = DATE_ADD(NOW(), INTERVAL 10 DAY)
      WHERE (name LIKE '%Waheed%' OR name LIKE '%waheed%')
        AND id IS NOT NULL
        AND is_deleted = 0
    `);
    console.log(`✅ Set ${waheedResult.affectedRows} Waheed shopkeepers to active\n`);

    // 3. Show final status distribution
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
    
    // 4. Show the updated shopkeepers
    console.log('\n📋 Updated Shopkeepers:');
    const [updated] = await pool.query(`
      SELECT id, name, shop_name, subscription_status, trial_start_date, next_payment_due
      FROM shopkeepers
      WHERE (name LIKE '%Waheed%' OR name LIKE '%waheed%' OR trial_start_date = DATE_SUB(NOW(), INTERVAL 100 DAY))
        AND id IS NOT NULL
        AND is_deleted = 0
      ORDER BY id DESC
      LIMIT 10
    `);
    
    updated.forEach(s => {
      console.log(`  ID ${s.id}: ${s.name} (${s.shop_name})`);
      console.log(`    Status: ${s.subscription_status}`);
      console.log(`    Trial Start: ${s.trial_start_date}`);
      console.log(`    Next Due: ${s.next_payment_due}`);
      console.log('');
    });
    
    console.log('✅ Manual update complete!');
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

setSpecificShopkeepersActive();
