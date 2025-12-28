import pool from '../config/db.js';

/**
 * Update subscription statuses for all shopkeepers based on their payment due dates
 * This should be run periodically (e.g., daily cron job)
 */

const updateSubscriptionStatuses = async () => {
  try {
    console.log('🔄 Updating subscription statuses...\n');

    const now = new Date();

    // Get all shopkeepers with subscription data
    const [shopkeepers] = await pool.query(`
      SELECT 
        id, 
        name, 
        shop_name,
        subscription_status,
        trial_start_date,
        trial_end_date,
        created_at,
        next_payment_due,
        grace_period_end,
        last_payment_date
      FROM shopkeepers
      WHERE is_deleted = 0
      ORDER BY id
    `);

    console.log(`Found ${shopkeepers.length} shopkeeper(s) to check\n`);

    let trialCount = 0;
    let activeCount = 0;
    let overdueCount = 0;
    let suspendedCount = 0;

    for (const shopkeeper of shopkeepers) {
      let newStatus = shopkeeper.subscription_status;
      
      // Calculate trial end date
      const trialStart = new Date(shopkeeper.trial_start_date || shopkeeper.created_at);
      const trialEnd = new Date(trialStart);
      trialEnd.setDate(trialEnd.getDate() + 90); // 90-day trial

      // Check if in trial period
      if (now < trialEnd) {
        newStatus = 'trial';
        trialCount++;
      } else {
        // Trial ended - check payment status
        if (shopkeeper.grace_period_end) {
          const gracePeriodEnd = new Date(shopkeeper.grace_period_end);
          
          if (now > gracePeriodEnd) {
            // Past grace period - SUSPENDED
            newStatus = 'suspended';
            suspendedCount++;
          } else if (shopkeeper.next_payment_due) {
            const nextPaymentDue = new Date(shopkeeper.next_payment_due);
            
            if (now > nextPaymentDue) {
              // Past due but within grace period - OVERDUE
              newStatus = 'overdue';
              overdueCount++;
            } else {
              // Payment not yet due - ACTIVE
              newStatus = 'active';
              activeCount++;
            }
          } else {
            // No payment due date set - set to active
            newStatus = 'active';
            activeCount++;
          }
        } else {
          // No grace period set - check if payment is due
          if (shopkeeper.next_payment_due) {
            const nextPaymentDue = new Date(shopkeeper.next_payment_due);
            
            if (now > nextPaymentDue) {
              // Payment overdue but no grace period set - set to overdue
              newStatus = 'overdue';
              overdueCount++;
            } else {
              newStatus = 'active';
              activeCount++;
            }
          } else {
            // Trial ended but no payment dates set - set to active and create payment schedule
            newStatus = 'active';
            activeCount++;
            
            // Set initial payment dates
            const nextPaymentDue = new Date(trialEnd);
            nextPaymentDue.setDate(nextPaymentDue.getDate() + 15); // 15 days after trial
            
            const gracePeriodEnd = new Date(nextPaymentDue);
            gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 2); // 2-day grace period
            
            await pool.query(
              `UPDATE shopkeepers 
               SET next_payment_due = ?, grace_period_end = ?
               WHERE id = ?`,
              [nextPaymentDue, gracePeriodEnd, shopkeeper.id]
            );
          }
        }
      }

      // Update status if changed
      if (newStatus !== shopkeeper.subscription_status) {
        await pool.query(
          `UPDATE shopkeepers SET subscription_status = ? WHERE id = ?`,
          [newStatus, shopkeeper.id]
        );
        
        console.log(`✅ Updated ${shopkeeper.name} (${shopkeeper.shop_name}): ${shopkeeper.subscription_status} → ${newStatus}`);
      }
    }

    console.log('\n📊 Summary:');
    console.log(`   Trial: ${trialCount}`);
    console.log(`   Active: ${activeCount}`);
    console.log(`   Overdue (Grace Period): ${overdueCount}`);
    console.log(`   Suspended: ${suspendedCount}`);
    console.log(`   Total: ${shopkeepers.length}`);
    
    console.log('\n🎉 Subscription statuses updated successfully!');
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error updating subscription statuses:', err);
    console.error('Error details:', err.message);
    process.exit(1);
  }
};

updateSubscriptionStatuses();
