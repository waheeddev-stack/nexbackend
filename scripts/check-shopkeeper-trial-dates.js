import 'dotenv/config';
import pool from '../config/db.js';

async function checkTrialDates() {
  try {
    console.log('🔍 Checking trial dates for recent shopkeepers...\n');
    
    const [shopkeepers] = await pool.query(`
      SELECT 
        id, 
        name, 
        shop_name, 
        created_at,
        trial_start_date,
        trial_end_date,
        subscription_status,
        DATEDIFF(NOW(), COALESCE(trial_start_date, created_at)) as days_since_start
      FROM shopkeepers
      WHERE id IS NOT NULL AND is_deleted = 0
      ORDER BY id DESC
      LIMIT 10
    `);
    
    console.log('📋 Recent Shopkeepers:\n');
    
    shopkeepers.forEach(s => {
      const daysInTrial = s.days_since_start || 0;
      const trialComplete = daysInTrial >= 90;
      
      console.log(`ID ${s.id}: ${s.name} (${s.shop_name})`);
      console.log(`  Created: ${s.created_at}`);
      console.log(`  Days since start: ${daysInTrial} days`);
      console.log(`  Trial complete: ${trialComplete ? 'YES ✅' : 'NO ❌'}`);
      console.log(`  Current status: ${s.subscription_status || 'NULL'}`);
      console.log(`  Should be: ${trialComplete ? 'active/overdue/suspended' : 'trial'}`);
      console.log('');
    });
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkTrialDates();
