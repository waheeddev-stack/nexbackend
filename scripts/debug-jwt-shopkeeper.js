#!/usr/bin/env node

import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

const BACKEND_URL = process.env.BACKEND_URL || 'https://nexbackend.onrender.com';

async function debugJWTShopkeeper() {
  console.log('🔍 DEBUG: JWT & Shopkeeper Issue Analysis');
  console.log('============================================================');
  console.log(`Backend URL: ${BACKEND_URL}`);
  console.log(`Test Started: ${new Date().toISOString()}\n`);

  try {
    // Step 1: Check shopkeeper in database
    console.log('1. 🗄️ Checking shopkeeper in database...');
    const [shopkeepers] = await pool.query(
      'SELECT id, email, name, shop_name, is_verified FROM shopkeepers WHERE email = ?',
      ['test@shopkeeper.com']
    );

    if (shopkeepers.length === 0) {
      console.log('   ❌ No shopkeeper found with email test@shopkeeper.com');
      return;
    }

    const shopkeeper = shopkeepers[0];
    console.log('   ✅ Shopkeeper found in database:');
    console.log(`      ID: ${shopkeeper.id} (type: ${typeof shopkeeper.id})`);
    console.log(`      Email: ${shopkeeper.email}`);
    console.log(`      Name: ${shopkeeper.name}`);
    console.log(`      Shop: ${shopkeeper.shop_name}`);
    console.log(`      Verified: ${shopkeeper.is_verified}`);

    // Step 2: Test authentication and get token
    console.log('\n2. 🔐 Testing authentication...');
    const loginResponse = await fetch(`${BACKEND_URL}/api/shopkeeper/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@shopkeeper.com',
        password: 'test123'
      })
    });

    const loginData = await loginResponse.json();
    
    if (!loginData.success) {
      console.log(`   ❌ Authentication failed: ${loginData.message}`);
      return;
    }

    console.log('   ✅ Authentication successful');
    console.log(`   ✅ Token received: ${loginData.token.substring(0, 50)}...`);
    console.log(`   ✅ User data: ${JSON.stringify(loginData.user, null, 2)}`);

    // Step 3: Decode JWT token
    console.log('\n3. 🔓 Decoding JWT token...');
    try {
      const decoded = jwt.verify(loginData.token, process.env.JWT_SECRET);
      console.log('   ✅ JWT token decoded successfully:');
      console.log(`      Payload: ${JSON.stringify(decoded, null, 2)}`);
      console.log(`      User ID: ${decoded.id} (type: ${typeof decoded.id})`);
      
      // Check if decoded ID matches database ID
      if (decoded.id == shopkeeper.id) {
        console.log('   ✅ JWT ID matches database ID');
      } else {
        console.log(`   ❌ JWT ID (${decoded.id}) does not match database ID (${shopkeeper.id})`);
      }
    } catch (error) {
      console.log(`   ❌ JWT decode error: ${error.message}`);
      return;
    }

    // Step 4: Test order listing endpoint with token
    console.log('\n4. 📦 Testing order listing endpoint...');
    const ordersResponse = await fetch(`${BACKEND_URL}/api/shopkeeper/orders`, {
      headers: { 'Authorization': `Bearer ${loginData.token}` }
    });

    console.log(`   📊 Response status: ${ordersResponse.status}`);
    console.log(`   📊 Response headers: ${JSON.stringify(Object.fromEntries(ordersResponse.headers), null, 2)}`);

    const ordersData = await ordersResponse.json();
    console.log(`   📊 Response data: ${JSON.stringify(ordersData, null, 2)}`);

    if (ordersResponse.ok && ordersData.success) {
      console.log('   ✅ Order listing successful');
      console.log(`   ✅ Found ${ordersData.orders?.length || 0} orders`);
    } else {
      console.log(`   ❌ Order listing failed: ${ordersData.message || 'Unknown error'}`);
      
      // Step 5: Debug the middleware issue
      console.log('\n5. 🔍 Debugging middleware issue...');
      
      // Check if shopkeeper exists with the JWT ID
      const [middlewareCheck] = await pool.query(
        'SELECT id, email, name, is_verified FROM shopkeepers WHERE id = ?',
        [jwt.verify(loginData.token, process.env.JWT_SECRET).id]
      );
      
      if (middlewareCheck.length === 0) {
        console.log('   ❌ Shopkeeper not found with JWT ID in middleware check');
        console.log('   💡 This explains the "Shopkeeper not found" error');
      } else {
        console.log('   ✅ Shopkeeper found with JWT ID in middleware check');
        console.log(`   📋 Middleware shopkeeper: ${JSON.stringify(middlewareCheck[0], null, 2)}`);
      }
    }

    // Step 6: Check orders table for this shopkeeper
    console.log('\n6. 📋 Checking orders for this shopkeeper...');
    const [orders] = await pool.query(
      'SELECT id, user_id, shopkeeper_id, status, total_amount, created_at FROM orders WHERE shopkeeper_id = ?',
      [shopkeeper.id]
    );
    
    console.log(`   📊 Found ${orders.length} orders for shopkeeper ID ${shopkeeper.id}`);
    if (orders.length > 0) {
      orders.forEach((order, index) => {
        console.log(`   ${index + 1}. Order #${order.id}: ${order.status} - ₹${order.total_amount}`);
      });
    }

  } catch (error) {
    console.error('❌ Debug failed:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    await pool.end();
  }

  console.log(`\n🕒 Debug Completed: ${new Date().toISOString()}`);
  console.log('============================================================');
}

debugJWTShopkeeper();