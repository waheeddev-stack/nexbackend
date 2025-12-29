import 'dotenv/config';
import pool from '../config/db.js';

async function setIdsActive() {
  try {
    console.log('🔄 Setting shopkeepers ID 24 and 31 to active status...\n');
    
    const now = new Date();
    const trialStart = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
    const nextDue = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days from now
    
    // Update IDs 24 and 31 to active
    const [result] = await pool.query(`
      UPDATE shopkeepers 
      SET subscription_status = 'active',
          trial_start_date = ?,
          next_payment_due = ?
      WHERE id IN (24, 31)
    `, [trialStart, nextDue]);
    
    console.log(`✅ Updated ${result.affectedRows} shopkeeper(s) to active status\n`);
    
    // Show updated shopkeepers
    const [shopkeepers] = await pool.query(`
      SELECT id, name, shop_name, subscription_status, next_payment_due
      FROM shopkeepers
      WHERE id IN (24, 31)
    `);
    
    console.log('Updated shopkeepers:');
    shopkeepers.forEach(s => {
      console.log(`  ID ${s.id}: ${s.name} (${s.shop_name})`);
      console.log(`    Status: ${s.subscription_status}`);
      console.log(`    Next Due: ${s.next_payment_due}`);
      console.log('');
    });
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

setIdsActive();
