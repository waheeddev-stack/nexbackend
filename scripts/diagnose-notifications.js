import pool from '../config/db.js';
import { sendFCMPush, isFCMToken } from '../utils/fcmPush.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Comprehensive notification diagnostic script
 * Checks all aspects of the notification system
 */

async function diagnoseNotifications() {
  console.log('🔍 NOTIFICATION SYSTEM DIAGNOSTIC\n');
  console.log('='.repeat(60));
  
  let allChecksPass = true;

  // CHECK 1: Firebase Service Account
  console.log('\n📋 CHECK 1: Firebase Service Account Configuration');
  console.log('-'.repeat(60));
  
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.log('✅ FIREBASE_SERVICE_ACCOUNT is set');
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      console.log(`   Project ID: ${serviceAccount.project_id}`);
      console.log(`   Client Email: ${serviceAccount.client_email}`);
      console.log('✅ Service account JSON is valid');
    } catch (e) {
      console.error('❌ Service account JSON is invalid:', e.message);
      allChecksPass = false;
    }
  } else {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT is NOT set');
    console.error('   This is the most common reason for notification failures!');
    console.error('   Add it to your Render.com environment variables.');
    allChecksPass = false;
  }

  // CHECK 2: Database Connection
  console.log('\n📋 CHECK 2: Database Connection');
  console.log('-'.repeat(60));
  
  try {
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    allChecksPass = false;
    return;
  }

  // CHECK 3: Shopkeeper Tokens
  console.log('\n📋 CHECK 3: Shopkeeper Push Tokens');
  console.log('-'.repeat(60));
  
  try {
    const [shopkeepers] = await pool.query(`
      SELECT id, name, shop_name, expo_push_token, is_verified
      FROM shopkeepers
      WHERE is_verified = 1
      ORDER BY id
    `);

    console.log(`Found ${shopkeepers.length} verified shopkeeper(s)\n`);

    let tokensFound = 0;
    let fcmTokens = 0;
    let expoTokens = 0;
    let noTokens = 0;

    for (const shop of shopkeepers) {
      const hasToken = !!shop.expo_push_token;
      const tokenType = hasToken 
        ? (isFCMToken(shop.expo_push_token) ? 'FCM' : 'Expo')
        : 'None';
      
      console.log(`Shopkeeper #${shop.id}: ${shop.shop_name || shop.name}`);
      console.log(`  Token: ${hasToken ? '✅ Present' : '❌ Missing'}`);
      if (hasToken) {
        console.log(`  Type: ${tokenType}`);
        console.log(`  Preview: ${shop.expo_push_token.substring(0, 30)}...`);
        tokensFound++;
        if (tokenType === 'FCM') fcmTokens++;
        else expoTokens++;
      } else {
        noTokens++;
      }
      console.log('');
    }

    console.log('Summary:');
    console.log(`  Total shopkeepers: ${shopkeepers.length}`);
    console.log(`  With tokens: ${tokensFound}`);
    console.log(`  FCM tokens: ${fcmTokens}`);
    console.log(`  Expo tokens: ${expoTokens}`);
    console.log(`  No tokens: ${noTokens}`);

    if (noTokens > 0) {
      console.warn(`\n⚠️ ${noTokens} shopkeeper(s) have no push token`);
      console.warn('   They need to login to the app to generate a token');
      allChecksPass = false;
    }

  } catch (error) {
    console.error('❌ Failed to check shopkeeper tokens:', error.message);
    allChecksPass = false;
  }

  // CHECK 4: Test FCM Send (if token available)
  console.log('\n📋 CHECK 4: Test FCM Notification');
  console.log('-'.repeat(60));
  
  try {
    const [[testShop]] = await pool.query(`
      SELECT id, name, shop_name, expo_push_token
      FROM shopkeepers
      WHERE is_verified = 1 AND expo_push_token IS NOT NULL
      LIMIT 1
    `);

    if (testShop && testShop.expo_push_token) {
      const token = testShop.expo_push_token;
      const tokenType = isFCMToken(token) ? 'FCM' : 'Expo';
      
      console.log(`Testing with shopkeeper: ${testShop.shop_name || testShop.name}`);
      console.log(`Token type: ${tokenType}`);
      
      if (tokenType === 'FCM') {
        console.log('\n📤 Sending test notification...');
        
        const result = await sendFCMPush(
          token,
          '🧪 Test Notification',
          'This is a test from the diagnostic script. If you see this, notifications are working!',
          { test: 'true', shopId: String(testShop.id) }
        );

        if (result.success) {
          console.log('✅ Test notification sent successfully!');
          console.log(`   Success count: ${result.successCount}`);
          console.log('   Check the shopkeeper app - notification should appear with sound');
        } else {
          console.error('❌ Test notification failed');
          console.error(`   Message: ${result.message}`);
          if (result.errors && result.errors.length > 0) {
            console.error('   Errors:', JSON.stringify(result.errors, null, 2));
          }
          allChecksPass = false;
        }

        if (result.invalidTokens && result.invalidTokens.length > 0) {
          console.warn('⚠️ Invalid tokens detected:', result.invalidTokens.length);
          console.warn('   These tokens should be removed from database');
        }
      } else {
        console.log('ℹ️ Shopkeeper has Expo token, not FCM');
        console.log('   Skipping FCM test (use Expo push service for this token)');
      }
    } else {
      console.warn('⚠️ No shopkeeper with push token found');
      console.warn('   Cannot test notification sending');
      console.warn('   Have a shopkeeper login to the app first');
    }
  } catch (error) {
    console.error('❌ Test notification failed:', error.message);
    console.error('   Stack:', error.stack);
    allChecksPass = false;
  }

  // CHECK 5: Recent Orders
  console.log('\n📋 CHECK 5: Recent Orders');
  console.log('-'.repeat(60));
  
  try {
    const [recentOrders] = await pool.query(`
      SELECT o.id, o.shopkeeper_id, o.status, o.created_at, s.shop_name
      FROM orders o
      JOIN shopkeepers s ON o.shopkeeper_id = s.id
      ORDER BY o.created_at DESC
      LIMIT 5
    `);

    if (recentOrders.length > 0) {
      console.log(`Found ${recentOrders.length} recent order(s):\n`);
      for (const order of recentOrders) {
        console.log(`Order #${order.id}`);
        console.log(`  Shop: ${order.shop_name}`);
        console.log(`  Status: ${order.status}`);
        console.log(`  Created: ${order.created_at}`);
        console.log('');
      }
    } else {
      console.log('ℹ️ No orders found in database');
    }
  } catch (error) {
    console.error('❌ Failed to check recent orders:', error.message);
  }

  // FINAL SUMMARY
  console.log('\n' + '='.repeat(60));
  console.log('📊 DIAGNOSTIC SUMMARY');
  console.log('='.repeat(60));
  
  if (allChecksPass) {
    console.log('\n✅ ALL CHECKS PASSED!');
    console.log('\nNotification system appears to be configured correctly.');
    console.log('If notifications still don\'t work:');
    console.log('1. Check device notification settings');
    console.log('2. Make sure app has notification permission');
    console.log('3. Check backend logs when order is placed');
    console.log('4. Verify shopkeeper is logged in and token is fresh');
  } else {
    console.log('\n❌ SOME CHECKS FAILED');
    console.log('\nPlease fix the issues above and run this script again.');
    console.log('\nMost common fixes:');
    console.log('1. Add FIREBASE_SERVICE_ACCOUNT to Render.com environment variables');
    console.log('2. Have shopkeepers login to app to generate push tokens');
    console.log('3. Restart backend after adding environment variables');
  }

  console.log('\n' + '='.repeat(60));
  
  await pool.end();
}

// Run diagnostic
diagnoseNotifications().catch(error => {
  console.error('\n💥 DIAGNOSTIC SCRIPT ERROR:', error);
  process.exit(1);
});
