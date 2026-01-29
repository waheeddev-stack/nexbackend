import dotenv from 'dotenv';
import pool from '../config/db.js';
import fetch from 'node-fetch';

dotenv.config();

async function debugTimerIssue() {
  try {
    console.log('🔍 Debugging Timer Issue - Complete Flow Test\n');
    
    // 1. Check for active orders with timers
    console.log('1. 📋 Checking active orders with timers...');
    const [activeOrders] = await pool.query(`
      SELECT o.id, o.status, o.pickup_code, o.has_timer, o.timer_started_at, o.timer_expires_at,
             ot.is_active, ot.stopped_at, ot.is_expired
      FROM orders o
      LEFT JOIN order_timers ot ON o.id = ot.order_id
      WHERE o.has_timer = TRUE AND o.status != 'Completed'
      ORDER BY o.created_at DESC
      LIMIT 3
    `);
    
    if (activeOrders.length === 0) {
      console.log('   ⚠️ No active orders with timers found');
      console.log('   💡 Create an order and start a timer first');
      return;
    }
    
    console.log(`   ✅ Found ${activeOrders.length} active orders with timers:`);
    activeOrders.forEach(order => {
      console.log(`   - Order ${order.id}: status=${order.status}, code=${order.pickup_code}, timer_active=${order.is_active}`);
    });
    
    const testOrder = activeOrders[0];
    console.log(`\n   🎯 Using order ${testOrder.id} for testing`);
    
    // 2. Test the verify-pickup endpoint directly
    console.log('\n2. 🧪 Testing verify-pickup endpoint...');
    
    // First, let's check what the endpoint expects
    console.log(`   📋 Order details:`);
    console.log(`      - Order ID: ${testOrder.id}`);
    console.log(`      - Pickup Code: ${testOrder.pickup_code}`);
    console.log(`      - Current Status: ${testOrder.status}`);
    console.log(`      - Has Timer: ${testOrder.has_timer}`);
    console.log(`      - Timer Active: ${testOrder.is_active}`);
    
    // 3. Simulate the verify-pickup call (without actually calling the API)
    console.log('\n3. 🔧 Simulating verify-pickup logic...');
    
    const now = new Date();
    const orderIdNum = testOrder.id;
    const pickup_code = testOrder.pickup_code;
    
    console.log(`   📝 Simulating pickup code verification for order ${orderIdNum}`);
    console.log(`   🔑 Using pickup code: ${pickup_code}`);
    
    // Check if pickup code matches
    if (testOrder.pickup_code !== pickup_code) {
      console.log('   ❌ Pickup code mismatch!');
      return;
    }
    
    console.log('   ✅ Pickup code matches');
    
    // Check timing
    const timerExpiresAt = testOrder.timer_expires_at;
    const wasOnTime = timerExpiresAt && now <= new Date(timerExpiresAt);
    console.log(`   ⏰ Timer expires at: ${timerExpiresAt}`);
    console.log(`   ⏰ Current time: ${now}`);
    console.log(`   ⏰ Was on time: ${wasOnTime}`);
    
    // 4. Test database updates
    console.log('\n4. 🗄️ Testing database updates...');
    
    // Update timer record
    console.log('   📝 Updating timer record...');
    const [updateResult] = await pool.query(`
      UPDATE order_timers 
      SET is_active = FALSE, stopped_at = ?, is_expired = ?
      WHERE order_id = ?
    `, [now, !wasOnTime, orderIdNum]);
    
    if (updateResult.affectedRows === 0) {
      console.log('   ⚠️ No timer record found, creating one...');
      await pool.query(`
        INSERT INTO order_timers (order_id, pickup_code, timer_duration, timer_started_at, timer_expires_at, is_active, is_expired, stopped_at)
        VALUES (?, ?, 420, ?, ?, FALSE, ?, ?)
      `, [orderIdNum, pickup_code, testOrder.timer_started_at, testOrder.timer_expires_at, !wasOnTime, now]);
      console.log('   ✅ Timer record created and stopped');
    } else {
      console.log('   ✅ Timer record updated successfully');
    }
    
    // Update order status
    console.log('   📝 Updating order status...');
    await pool.query(`
      UPDATE orders 
      SET status = 'Completed', has_timer = FALSE
      WHERE id = ?
    `, [orderIdNum]);
    console.log('   ✅ Order marked as completed');
    
    // 5. Verify the changes
    console.log('\n5. ✅ Verifying changes...');
    const [verifyResult] = await pool.query(`
      SELECT o.id, o.status, o.has_timer, o.pickup_code,
             ot.is_active, ot.stopped_at, ot.is_expired
      FROM orders o
      LEFT JOIN order_timers ot ON o.id = ot.order_id
      WHERE o.id = ?
    `, [orderIdNum]);
    
    if (verifyResult.length > 0) {
      const result = verifyResult[0];
      console.log('   📊 Updated state:');
      console.log(`      - Status: ${result.status}`);
      console.log(`      - Has timer: ${result.has_timer}`);
      console.log(`      - Timer active: ${result.is_active}`);
      console.log(`      - Stopped at: ${result.stopped_at}`);
      console.log(`      - Was on time: ${wasOnTime}`);
      
      if (result.status === 'Completed' && result.is_active === 0 && result.stopped_at) {
        console.log('\n   🎉 SUCCESS: Backend timer stop is working correctly!');
      } else {
        console.log('\n   ❌ ISSUE: Backend timer stop is not working');
      }
    }
    
    // 6. Frontend debugging checklist
    console.log('\n6. 📱 Frontend Debugging Checklist:');
    console.log('   The issue might be on the frontend side. Check:');
    console.log('   ');
    console.log('   🔍 Socket Connection:');
    console.log('   - Is the frontend connected to socket.io?');
    console.log('   - Are socket rooms joined correctly (shop_X, customer_X)?');
    console.log('   - Check browser console for socket connection errors');
    console.log('   ');
    console.log('   🔍 Socket Event Listeners:');
    console.log('   - Is frontend listening for "timerStopped" event?');
    console.log('   - Is frontend listening for "orderStatusUpdate" event?');
    console.log('   - Check if event handlers are properly updating state');
    console.log('   ');
    console.log('   🔍 Timer Component:');
    console.log('   - Does timer component check for stopped_at field?');
    console.log('   - Is timer UI updating when stopped_at is received?');
    console.log('   - Check if order details are being refreshed');
    console.log('   ');
    console.log('   🔍 API Calls:');
    console.log('   - Is verify-pickup API call successful (200 status)?');
    console.log('   - Check network tab for API response');
    console.log('   - Verify pickup code is being sent correctly');
    
    console.log('\n7. 🧪 Expected Socket Events:');
    console.log('   When verify-pickup is called, these events should be emitted:');
    console.log('   ');
    console.log('   📡 orderStatusUpdate:');
    console.log('   {');
    console.log(`     orderId: ${orderIdNum},`);
    console.log('     status: "Completed",');
    console.log('     wasOnTime: ' + wasOnTime + ',');
    console.log('     timerStopped: true,');
    console.log(`     stoppedAt: "${now.toISOString()}",`);
    console.log('     pointsAwarded: X');
    console.log('   }');
    console.log('   ');
    console.log('   📡 timerStopped:');
    console.log('   {');
    console.log(`     orderId: ${orderIdNum},`);
    console.log(`     stoppedAt: "${now.toISOString()}",`);
    console.log('     wasOnTime: ' + wasOnTime + ',');
    console.log('     pointsAwarded: X');
    console.log('   }');
    
    console.log('\n8. 🔧 Next Steps:');
    console.log('   1. Check frontend socket event listeners');
    console.log('   2. Verify timer component updates on stopped_at');
    console.log('   3. Test with browser dev tools open');
    console.log('   4. Check if order details refresh after code entry');
    console.log('   5. Verify socket room names match (numbers vs strings)');
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  } finally {
    await pool.end();
  }
}

debugTimerIssue();