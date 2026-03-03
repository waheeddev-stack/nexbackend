import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function resetShopkeeperTimestamps() {
  let connection;
  
  try {
    connection = await pool.getConnection();
    
    console.log('🔧 RESETTING ALL SHOPKEEPER TIMESTAMPS TO DAY 0\n');
    console.log('================================================================================\n');
    
    // Get current state
    console.log('📊 BEFORE RESET:\n');
    const [beforeStats] = await connection.execute(`
      SELECT 
        subscription_status,
        COUNT(*) as count
      FROM shopkeepers
      WHERE id IS NOT NULL
      GROUP BY subscription_status
    `);
    console.table(beforeStats);
    
    // Show sample of current timestamps
    const [beforeSample] = await connection.execute(`
      SELECT 
        id,
        name,
        email,
        subscription_status,
        last_payment_date,
        next_payment_due,
        grace_period_end
      FROM shopkeepers
      WHERE id IS NOT NULL
      ORDER BY id
      LIMIT 5
    `);
    console.log('\n📋 Sample of current timestamps (first 5):');
    console.table(beforeSample);
    
    console.log('\n🔄 RESETTING TIMESTAMPS...\n');
    
    // Reset all shopkeepers to day 0 (billing starts from day 1)
    // 15-day billing cycle + 2-day grace period = 17 days total
    const now = new Date();
    const nextPaymentDue = new Date(now);
    nextPaymentDue.setDate(nextPaymentDue.getDate() + 15); // 15 days from now
    
    const gracePeriodEnd = new Date(nextPaymentDue);
    gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 2); // 2 days after payment due
    
    // Update all verified shopkeepers
    const [updateResult] = await connection.execute(`
      UPDATE shopkeepers 
      SET 
        subscription_status = 'active',
        last_payment_date = NOW(),
        next_payment_due = ?,
        grace_period_end = ?
      WHERE is_verified = 1
    `, [nextPaymentDue, gracePeriodEnd]);
    
    console.log(`✅ Updated ${updateResult.affectedRows} verified shopkeeper(s)\n`);
    
    // Get updated state
    console.log('📊 AFTER RESET:\n');
    const [afterStats] = await connection.execute(`
      SELECT 
        subscription_status,
        COUNT(*) as count
      FROM shopkeepers
      WHERE id IS NOT NULL
      GROUP BY subscription_status
    `);
    console.table(afterStats);
    
    // Show sample of updated timestamps
    const [afterSample] = await connection.execute(`
      SELECT 
        id,
        name,
        email,
        subscription_status,
        last_payment_date,
        next_payment_due,
        grace_period_end,
        DATEDIFF(next_payment_due, NOW()) as days_until_due
      FROM shopkeepers
      WHERE id IS NOT NULL AND is_verified = 1
      ORDER BY id
      LIMIT 5
    `);
    console.log('\n📋 Sample of updated timestamps (first 5):');
    console.table(afterSample);
    
    console.log('\n================================================================================');
    console.log('✅ TIMESTAMP RESET COMPLETE!\n');
    
    console.log('📅 BILLING CYCLE SETUP:');
    console.log(`   - Last Payment: ${now.toISOString().split('T')[0]} (TODAY)`);
    console.log(`   - Next Payment Due: ${nextPaymentDue.toISOString().split('T')[0]} (15 days from now)`);
    console.log(`   - Grace Period End: ${gracePeriodEnd.toISOString().split('T')[0]} (17 days from now)`);
    console.log('\n📋 SUBSCRIPTION STATUS FLOW:');
    console.log('   Day 0-14:  subscription_status = "active" (normal operation)');
    console.log('   Day 15:    Payment due date passes → "overdue"');
    console.log('   Day 15-16: subscription_status = "grace_period" (2-day grace)');
    console.log('   Day 17+:   Grace period ends → "suspended" (auto-suspended)');
    
    console.log('\n🔄 AUTOMATIC SUSPENSION CRON:');
    console.log('   The cron job runs daily at midnight and will:');
    console.log('   1. Move overdue shopkeepers to grace_period');
    console.log('   2. Move expired grace_period shopkeepers to suspended');
    console.log('   3. Suspended shopkeepers cannot login to the app');
    
    console.log('\n🧪 TESTING:');
    console.log('   To test automatic suspension immediately:');
    console.log('   1. Manually set next_payment_due to yesterday for a shopkeeper');
    console.log('   2. Manually set grace_period_end to yesterday');
    console.log('   3. Run the cron job: node cron/subscription.status.cron.js');
    console.log('   4. Verify shopkeeper is suspended');
    console.log('   5. Try to login with that shopkeeper (should be blocked)');
    
    console.log('\n📝 MANUAL SUSPENSION:');
    console.log('   Admin can manually suspend/unsuspend anytime from admin panel');
    console.log('   - Suspend: Sets subscription_status = "suspended"');
    console.log('   - Unsuspend: Sets subscription_status = "active"');
    
    console.log('\n================================================================================\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    if (connection) {
      connection.release();
    }
    await pool.end();
  }
}

resetShopkeeperTimestamps();
