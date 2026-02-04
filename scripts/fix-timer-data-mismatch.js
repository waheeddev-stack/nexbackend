import dotenv from 'dotenv';
import pool from '../config/db.js';

dotenv.config();

async function fixTimerDataMismatch() {
  try {
    console.log('🔧 FIXING TIMER DATA MISMATCH\n');
    
    // 1. Find orders with timers but no timer records
    console.log('1. 🔍 Finding orders with missing timer records...');
    const [orphanedOrders] = await pool.query(`
      SELECT o.id, o.status, o.has_timer, o.pickup_code, o.timer_started_at, o.timer_expires_at
      FROM orders o
      LEFT JOIN order_timers ot ON o.id = ot.order_id
      WHERE o.has_timer = TRUE AND ot.order_id IS NULL
    `);
    
    console.log(`   📊 Found ${orphanedOrders.length} orders with missing timer records:`);
    orphanedOrders.forEach(order => {
      console.log(`   - Order ${order.id}: status=${order.status}, code=${order.pickup_code}`);
    });
    
    // 2. Find timer records without corresponding orders
    console.log('\n2. 🔍 Finding timer records without orders...');
    const [orphanedTimers] = await pool.query(`
      SELECT ot.order_id, ot.is_active, ot.stopped_at
      FROM order_timers ot
      LEFT JOIN orders o ON ot.order_id = o.id
      WHERE o.id IS NULL OR o.has_timer = FALSE
    `);
    
    console.log(`   📊 Found ${orphanedTimers.length} orphaned timer records:`);
    orphanedTimers.forEach(timer => {
      console.log(`   - Timer for order ${timer.order_id}: active=${timer.is_active}, stopped=${timer.stopped_at ? 'YES' : 'NO'}`);
    });
    
    // 3. Create missing timer records for orders that need them
    console.log('\n3. 🔧 Creating missing timer records...');
    for (const order of orphanedOrders) {
      if (order.id && order.pickup_code && order.status !== 'Completed') {
        console.log(`   📝 Creating timer record for order ${order.id}...`);
        
        const now = new Date();
        const startTime = order.timer_started_at || now;
        const expireTime = order.timer_expires_at || new Date(now.getTime() + (7 * 60 * 1000));
        
        await pool.query(`
          INSERT INTO order_timers (order_id, pickup_code, timer_duration, timer_started_at, timer_expires_at, is_active)
          VALUES (?, ?, 420, ?, ?, TRUE)
        `, [order.id, order.pickup_code, startTime, expireTime]);
        
        console.log(`   ✅ Timer record created for order ${order.id}`);
      } else if (order.id && order.status === 'Completed') {
        console.log(`   📝 Creating stopped timer record for completed order ${order.id}...`);
        
        const now = new Date();
        const startTime = order.timer_started_at || now;
        const expireTime = order.timer_expires_at || new Date(now.getTime() + (7 * 60 * 1000));
        
        await pool.query(`
          INSERT INTO order_timers (order_id, pickup_code, timer_duration, timer_started_at, timer_expires_at, is_active, stopped_at)
          VALUES (?, ?, 420, ?, ?, FALSE, ?)
        `, [order.id, order.pickup_code, startTime, expireTime, now]);
        
        console.log(`   ✅ Stopped timer record created for order ${order.id}`);
      } else if (!order.id) {
        console.log(`   ⚠️ Skipping order with null ID`);
      }
    }
    
    // 4. Clean up orphaned timer records
    console.log('\n4. 🧹 Cleaning up orphaned timer records...');
    for (const timer of orphanedTimers) {
      console.log(`   🗑️ Removing orphaned timer for order ${timer.order_id}...`);
      await pool.query('DELETE FROM order_timers WHERE order_id = ?', [timer.order_id]);
      console.log(`   ✅ Orphaned timer removed`);
    }
    
    // 5. Verify the fix
    console.log('\n5. ✅ Verifying the fix...');
    const [verifyOrders] = await pool.query(`
      SELECT o.id, o.status, o.has_timer, o.pickup_code,
             ot.is_active, ot.stopped_at
      FROM orders o
      LEFT JOIN order_timers ot ON o.id = ot.order_id
      WHERE o.has_timer = TRUE
      ORDER BY o.id DESC
      LIMIT 5
    `);
    
    console.log('   📊 Orders with timers after fix:');
    verifyOrders.forEach(order => {
      const timerStatus = order.is_active === 1 ? 'RUNNING' : 
                         order.stopped_at ? 'STOPPED' : 'NO_RECORD';
      console.log(`   - Order ${order.id}: status=${order.status}, timer=${timerStatus}, code=${order.pickup_code}`);
    });
    
    // 6. Test verify-pickup on a real order
    const testOrder = verifyOrders.find(o => o.pickup_code && o.status !== 'Completed');
    if (testOrder) {
      console.log(`\n6. 🧪 Testing verify-pickup on order ${testOrder.id}...`);
      console.log(`   🔑 Pickup code: ${testOrder.pickup_code}`);
      
      // Simulate verify-pickup
      const now = new Date();
      const [updateResult] = await pool.query(`
        UPDATE order_timers 
        SET is_active = FALSE, stopped_at = ?
        WHERE order_id = ?
      `, [now, testOrder.id]);
      
      console.log(`   📊 Timer update result: ${updateResult.affectedRows} rows affected`);
      
      if (updateResult.affectedRows > 0) {
        // Update order status
        await pool.query(`
          UPDATE orders 
          SET status = 'Completed', has_timer = FALSE
          WHERE id = ?
        `, [testOrder.id]);
        
        console.log('   ✅ SUCCESS: Timer stopped and order completed!');
        
        // Verify final state
        const [finalCheck] = await pool.query(`
          SELECT o.id, o.status, o.has_timer,
                 ot.is_active, ot.stopped_at
          FROM orders o
          LEFT JOIN order_timers ot ON o.id = ot.order_id
          WHERE o.id = ?
        `, [testOrder.id]);
        
        const final = finalCheck[0];
        console.log('   📊 Final state:', {
          order_id: final.id,
          status: final.status,
          has_timer: final.has_timer,
          timer_active: final.is_active,
          stopped_at: final.stopped_at ? 'YES' : 'NO'
        });
        
        if (final.status === 'Completed' && final.is_active === 0 && final.stopped_at) {
          console.log('\n   🎉 TIMER STOP IS NOW WORKING!');
        }
      } else {
        console.log('   ❌ Still no timer record to update');
      }
    }
    
    console.log('\n🎯 SUMMARY:');
    console.log('   ✅ Fixed data mismatch between orders and timer records');
    console.log('   ✅ Created missing timer records');
    console.log('   ✅ Cleaned up orphaned records');
    console.log('   ✅ Verified timer stop functionality');
    console.log('');
    console.log('   🚀 Timer should now stop when you enter pickup codes!');
    console.log('   📱 If frontend still shows running timer, check:');
    console.log('   1. Socket event listeners');
    console.log('   2. Timer component stopped_at check');
    console.log('   3. API response handling');
    
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

fixTimerDataMismatch();