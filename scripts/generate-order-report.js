#!/usr/bin/env node

import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

async function generateOrderReport() {
  console.log('📊 GENERATING COMPREHENSIVE ORDER SYSTEM REPORT\n');
  console.log('='.repeat(60));

  const report = {
    timestamp: new Date().toISOString(),
    backend_url: BACKEND_URL,
    tests: {
      health_check: false,
      authentication: false,
      order_listing: false,
      order_filtering: false,
      status_update: false,
      timer_system: false,
      error_handling: false
    },
    endpoints: {
      'GET /api/shopkeeper/orders': 'UNKNOWN',
      'GET /api/shopkeeper/orders?status=X': 'UNKNOWN',
      'PATCH /api/shopkeeper/orders/:id/status': 'UNKNOWN',
      'POST /api/shopkeeper/orders/:id/start-timer': 'UNKNOWN',
      'POST /api/shopkeeper/orders/:id/stop-timer': 'UNKNOWN',
      'GET /api/shopkeeper/orders/:id/timer': 'UNKNOWN',
      'POST /api/shopkeeper/cleanup-expired-timers': 'UNKNOWN'
    },
    order_statuses: {
      valid_statuses: ['Pending', 'Processing', 'Delivered', 'Cancelled'],
      status_distribution: {},
      timer_enabled_orders: 0
    },
    performance: {
      response_times: {},
      error_count: 0,
      success_rate: 0
    },
    recommendations: []
  };

  try {
    // 1. Health Check
    console.log('1. 🏥 HEALTH CHECK');
    const startTime = Date.now();
    
    try {
      const healthResponse = await fetch(`${BACKEND_URL}/health`);
      const healthData = await healthResponse.json();
      
      if (healthData.status === 'healthy') {
        report.tests.health_check = true;
        console.log('   ✅ Backend is healthy');
      } else {
        console.log('   ❌ Backend health check failed');
      }
    } catch (error) {
      console.log('   ❌ Backend is not accessible');
      report.recommendations.push('Backend server is not accessible - check deployment');
    }

    // 2. Authentication Test
    console.log('\n2. 🔐 AUTHENTICATION TEST');
    let token = null;
    
    try {
      const loginResponse = await fetch(`${BACKEND_URL}/api/shopkeeper/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email: 'test@shopkeeper.com', 
          password: 'test123' 
        })
      });

      const loginData = await loginResponse.json();
      
      if (loginData.success && loginData.token) {
        token = loginData.token;
        report.tests.authentication = true;
        console.log('   ✅ Authentication successful');
      } else {
        console.log('   ❌ Authentication failed:', loginData.message);
        report.recommendations.push('Create test shopkeeper account or check authentication system');
      }
    } catch (error) {
      console.log('   ❌ Authentication error:', error.message);
    }

    if (!token) {
      console.log('\n❌ Cannot proceed without authentication token');
      return report;
    }

    // 3. Order Listing Test
    console.log('\n3. 📋 ORDER LISTING TEST');
    const orderStartTime = Date.now();
    
    try {
      const ordersResponse = await fetch(`${BACKEND_URL}/api/shopkeeper/orders`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const ordersData = await ordersResponse.json();
      report.performance.response_times['GET /orders'] = Date.now() - orderStartTime;
      
      if (ordersData.success) {
        report.tests.order_listing = true;
        report.endpoints['GET /api/shopkeeper/orders'] = 'WORKING';
        console.log('   ✅ Order listing successful');
        console.log(`   📊 Found ${ordersData.orders?.length || 0} orders`);
        
        // Analyze order statuses
        if (ordersData.orders && ordersData.orders.length > 0) {
          ordersData.orders.forEach(order => {
            const status = order.status;
            report.order_statuses.status_distribution[status] = 
              (report.order_statuses.status_distribution[status] || 0) + 1;
            
            if (order.has_timer) {
              report.order_statuses.timer_enabled_orders++;
            }
          });
        }
      } else {
        report.endpoints['GET /api/shopkeeper/orders'] = 'FAILED';
        console.log('   ❌ Order listing failed:', ordersData.message);
      }
    } catch (error) {
      report.endpoints['GET /api/shopkeeper/orders'] = 'ERROR';
      console.log('   ❌ Order listing error:', error.message);
      report.performance.error_count++;
    }

    // 4. Order Filtering Test
    console.log('\n4. 🔍 ORDER FILTERING TEST');
    
    for (const status of report.order_statuses.valid_statuses) {
      try {
        const filterResponse = await fetch(`${BACKEND_URL}/api/shopkeeper/orders?status=${status}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        const filterData = await filterResponse.json();
        
        if (filterData.success) {
          console.log(`   ✅ ${status} filter: ${filterData.orders?.length || 0} orders`);
          report.tests.order_filtering = true;
        } else {
          console.log(`   ❌ ${status} filter failed`);
        }
      } catch (error) {
        console.log(`   ❌ ${status} filter error:`, error.message);
      }
    }

    if (report.tests.order_filtering) {
      report.endpoints['GET /api/shopkeeper/orders?status=X'] = 'WORKING';
    }

    // 5. Status Update Test
    console.log('\n5. 🔄 STATUS UPDATE TEST');
    
    try {
      // Try to find a pending order to test with
      const pendingResponse = await fetch(`${BACKEND_URL}/api/shopkeeper/orders?status=Pending`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const pendingData = await pendingResponse.json();
      
      if (pendingData.success && pendingData.orders?.length > 0) {
        const testOrder = pendingData.orders[0];
        const orderId = testOrder.order_id || testOrder.id;
        
        // Test status update to Processing
        const updateResponse = await fetch(`${BACKEND_URL}/api/shopkeeper/orders/${orderId}/status`, {
          method: 'PATCH',
          headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ status: 'Processing' })
        });

        const updateData = await updateResponse.json();
        
        if (updateData.success) {
          report.tests.status_update = true;
          report.endpoints['PATCH /api/shopkeeper/orders/:id/status'] = 'WORKING';
          console.log('   ✅ Status update successful');
          
          // Revert back to Pending
          await fetch(`${BACKEND_URL}/api/shopkeeper/orders/${orderId}/status`, {
            method: 'PATCH',
            headers: { 
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: 'Pending' })
          });
        } else {
          report.endpoints['PATCH /api/shopkeeper/orders/:id/status'] = 'FAILED';
          console.log('   ❌ Status update failed:', updateData.message);
        }
      } else {
        console.log('   ⚠️  No pending orders to test status update');
      }
    } catch (error) {
      report.endpoints['PATCH /api/shopkeeper/orders/:id/status'] = 'ERROR';
      console.log('   ❌ Status update error:', error.message);
    }

    // 6. Timer System Test
    console.log('\n6. ⏰ TIMER SYSTEM TEST');
    
    try {
      const timerResponse = await fetch(`${BACKEND_URL}/api/shopkeeper/orders?status=Pending`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const timerData = await timerResponse.json();
      
      if (timerData.success && timerData.orders?.length > 0) {
        const testOrder = timerData.orders[0];
        const orderId = testOrder.order_id || testOrder.id;
        
        // Test start timer
        const startResponse = await fetch(`${BACKEND_URL}/api/shopkeeper/orders/${orderId}/start-timer`, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ timer_duration: 30 })
        });

        const startData = await startResponse.json();
        
        if (startData.success) {
          report.endpoints['POST /api/shopkeeper/orders/:id/start-timer'] = 'WORKING';
          console.log('   ✅ Timer start successful');
          
          // Test timer status
          const statusResponse = await fetch(`${BACKEND_URL}/api/shopkeeper/orders/${orderId}/timer`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });

          const statusData = await statusResponse.json();
          
          if (statusData.success) {
            report.endpoints['GET /api/shopkeeper/orders/:id/timer'] = 'WORKING';
            console.log('   ✅ Timer status check successful');
            
            // Test stop timer
            const stopResponse = await fetch(`${BACKEND_URL}/api/shopkeeper/orders/${orderId}/stop-timer`, {
              method: 'POST',
              headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ pickup_code: startData.pickup_code })
            });

            const stopData = await stopResponse.json();
            
            if (stopData.success) {
              report.endpoints['POST /api/shopkeeper/orders/:id/stop-timer'] = 'WORKING';
              report.tests.timer_system = true;
              console.log('   ✅ Timer stop successful');
            } else {
              report.endpoints['POST /api/shopkeeper/orders/:id/stop-timer'] = 'FAILED';
              console.log('   ❌ Timer stop failed:', stopData.message);
            }
          } else {
            report.endpoints['GET /api/shopkeeper/orders/:id/timer'] = 'FAILED';
            console.log('   ❌ Timer status failed:', statusData.message);
          }
        } else {
          report.endpoints['POST /api/shopkeeper/orders/:id/start-timer'] = 'FAILED';
          console.log('   ❌ Timer start failed:', startData.message);
        }
      } else {
        console.log('   ⚠️  No pending orders to test timer system');
      }
    } catch (error) {
      console.log('   ❌ Timer system error:', error.message);
    }

    // 7. Error Handling Test
    console.log('\n7. 🛡️ ERROR HANDLING TEST');
    
    try {
      // Test invalid order ID
      const invalidResponse = await fetch(`${BACKEND_URL}/api/shopkeeper/orders/999999/status`, {
        method: 'PATCH',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: 'Processing' })
      });

      const invalidData = await invalidResponse.json();
      
      if (!invalidData.success && invalidResponse.status === 404) {
        report.tests.error_handling = true;
        console.log('   ✅ Invalid order ID properly handled');
      }

      // Test invalid status
      const invalidStatusResponse = await fetch(`${BACKEND_URL}/api/shopkeeper/orders/1/status`, {
        method: 'PATCH',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: 'InvalidStatus' })
      });

      const invalidStatusData = await invalidStatusResponse.json();
      
      if (!invalidStatusData.success && invalidStatusResponse.status === 400) {
        console.log('   ✅ Invalid status properly rejected');
      }
    } catch (error) {
      console.log('   ❌ Error handling test failed:', error.message);
    }

    // Calculate success rate
    const totalTests = Object.keys(report.tests).length;
    const passedTests = Object.values(report.tests).filter(Boolean).length;
    report.performance.success_rate = Math.round((passedTests / totalTests) * 100);

    // Generate recommendations
    if (!report.tests.timer_system) {
      report.recommendations.push('Timer system needs database initialization - run: npm run init-timer-tables');
    }
    
    if (report.performance.success_rate < 80) {
      report.recommendations.push('System has significant issues - check backend logs and database connection');
    }
    
    if (Object.values(report.order_statuses.status_distribution).length === 0) {
      report.recommendations.push('No orders found - create test orders for proper testing');
    }

  } catch (error) {
    console.error('❌ Report generation failed:', error.message);
  }

  // Print final report
  console.log('\n' + '='.repeat(60));
  console.log('📊 FINAL REPORT SUMMARY');
  console.log('='.repeat(60));
  
  console.log(`\n🎯 Overall Success Rate: ${report.performance.success_rate}%`);
  
  console.log('\n📋 Test Results:');
  Object.entries(report.tests).forEach(([test, passed]) => {
    console.log(`   ${passed ? '✅' : '❌'} ${test.replace(/_/g, ' ').toUpperCase()}`);
  });
  
  console.log('\n🔗 Endpoint Status:');
  Object.entries(report.endpoints).forEach(([endpoint, status]) => {
    const icon = status === 'WORKING' ? '✅' : status === 'FAILED' ? '❌' : status === 'ERROR' ? '🔥' : '❓';
    console.log(`   ${icon} ${endpoint}: ${status}`);
  });
  
  if (Object.keys(report.order_statuses.status_distribution).length > 0) {
    console.log('\n📊 Order Status Distribution:');
    Object.entries(report.order_statuses.status_distribution).forEach(([status, count]) => {
      console.log(`   📦 ${status}: ${count} orders`);
    });
    console.log(`   ⏰ Timer-enabled orders: ${report.order_statuses.timer_enabled_orders}`);
  }
  
  if (report.recommendations.length > 0) {
    console.log('\n💡 Recommendations:');
    report.recommendations.forEach((rec, index) => {
      console.log(`   ${index + 1}. ${rec}`);
    });
  }
  
  console.log(`\n🕒 Report generated at: ${report.timestamp}`);
  console.log('='.repeat(60));

  return report;
}

generateOrderReport();