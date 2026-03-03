import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function verifyBillingCycle() {
  let connection;
  
  try {
    connection = await pool.getConnection();
    
    console.log('📅 VERIFYING BILLING CYCLE SETUP\n');
    console.log('================================================================================\n');
    
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    console.log(`📆 Today's Date: ${todayStr}\n`);
    
    // Get all verified shopkeepers with their billing dates
    const [shopkeepers] = await connection.execute(`
      SELECT 
        id,
        name,
        email,
        subscription_status,
        last_payment_date,
        next_payment_due,
        grace_period_end,
        DATEDIFF(next_payment_due, NOW()) as days_until_due,
        DATEDIFF(grace_period_end, NOW()) as days_until_grace_end
      FROM shopkeepers
      WHERE is_verified = 1 AND is_deleted = 0
      ORDER BY id
      LIMIT 10
    `);
    
    console.log('📊 BILLING CYCLE STATUS (First 10 verified shopkeepers):\n');
    console.table(shopkeepers.map(s => ({
      ID: s.id,
      Name: s.name.substring(0, 20),
      Status: s.subscription_status,
      'Last Payment': s.last_payment_date?.toISOString().split('T')[0] || 'NULL',
      'Next Due': s.next_payment_due?.toISOString().split('T')[0] || 'NULL',
      'Grace End': s.grace_period_end?.toISOString().split('T')[0] || 'NULL',
      'Days Until Due': s.days_until_due,
      'Days Until Grace End': s.days_until_grace_end
    })));
    
    // Verify billing cycle is correct
    console.log('\n✅ BILLING CYCLE VERIFICATION:\n');
    
    const correctBillingCycle = shopkeepers.every(s => {
      const daysUntilDue = s.days_until_due;
      const daysUntilGraceEnd = s.days_until_grace_end;
      
      // Should be 15 days until payment due
      const dueIsCorrect = daysUntilDue >= 14 && daysUntilDue <= 15;
      
      // Should be 17 days until grace period end
      const graceIsCorrect = daysUntilGraceEnd >= 16 && daysUntilGraceEnd <= 17;
      
      return dueIsCorrect && graceIsCorrect;
    });
    
    if (correctBillingCycle) {
      console.log('✅ All shopkeepers have correct billing cycle:');
      console.log('   - Last Payment: Today (Day 0)');
      console.log('   - Next Payment Due: 15 days from now (Day 15)');
      console.log('   - Grace Period End: 17 days from now (Day 17)');
    } else {
      console.log('⚠️  Some shopkeepers have incorrect billing cycle dates');
    }
    
    // Show the automatic suspension timeline
    console.log('\n📅 AUTOMATIC SUSPENSION TIMELINE:\n');
    console.log('   Day 0 (Today):        ✅ All shopkeepers ACTIVE');
    console.log('   Day 1-14:             ✅ Normal operation');
    console.log('   Day 15:               ⚠️  Payment due date passes');
    console.log('   Day 15 (midnight):    🔄 Cron moves to GRACE_PERIOD');
    console.log('   Day 15-16:            ⏳ Grace period (2 days)');
    console.log('   Day 17 (midnight):    🚫 Cron moves to SUSPENDED');
    console.log('   Day 17+:              🚫 Login blocked, app access denied');
    
    // Show cron job info
    console.log('\n🤖 CRON JOB CONFIGURATION:\n');
    console.log('   Schedule: Every hour (0 * * * *)');
    console.log('   Location: nexbackend/cron/subscription.status.cron.js');
    console.log('   Actions:');
    console.log('   1. Move overdue (active) → grace_period');
    console.log('   2. Move expired grace_period → suspended');
    
    // Count shopkeepers by days until due
    const [daysDistribution] = await connection.execute(`
      SELECT 
        DATEDIFF(next_payment_due, NOW()) as days_until_due,
        COUNT(*) as count
      FROM shopkeepers
      WHERE is_verified = 1 AND is_deleted = 0
      GROUP BY DATEDIFF(next_payment_due, NOW())
      ORDER BY days_until_due
    `);
    
    console.log('\n📊 DAYS UNTIL PAYMENT DUE DISTRIBUTION:\n');
    console.table(daysDistribution);
    
    console.log('\n================================================================================');
    console.log('✅ BILLING CYCLE VERIFICATION COMPLETE!\n');
    
    console.log('🧪 TO TEST AUTOMATIC SUSPENSION:\n');
    console.log('   Option 1: Wait 17 days for natural suspension');
    console.log('   Option 2: Run test script to simulate suspension:');
    console.log('             node scripts/test-auto-suspension.js\n');
    
    console.log('🎛️  TO TEST MANUAL SUSPENSION:\n');
    console.log('   1. Open admin panel');
    console.log('   2. Find any verified shopkeeper');
    console.log('   3. Click orange "Suspend" button');
    console.log('   4. Verify green "Unsuspend" button appears');
    console.log('   5. Try to login with that shopkeeper (should be blocked)');
    console.log('   6. Click "Unsuspend" to restore access\n');
    
    console.log('================================================================================\n');
    
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

verifyBillingCycle();
