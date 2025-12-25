import dotenv from 'dotenv';
import pool from './config/db.js';
import { sendFCMPush, isFCMToken } from './utils/fcmPush.js';

dotenv.config();

console.log('\n🔍 Complete Notification System Diagnostic\n');
console.log('=' .repeat(60));

async function diagnose() {
  try {
    // 1. Check Firebase environment variable
    console.log('\n1️⃣ Checking Firebase Configuration...');
    const firebaseEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
    
    if (!firebaseEnv) {
      console.error('❌ FIREBASE_SERVICE_ACCOUNT not set');
      console.error('   Add this to your .env file or Render environment variables');
      return false;
    }
    
    console.log('✅ FIREBASE_SERVICE_ACCOUNT is set');
    console.log(`   Length: ${firebaseEnv.length} characters`);
    
    try {
      const parsed = JSON.parse(firebaseEnv);
      console.log(`   Project: ${parsed.project_id}`);
      console.log(`   Email: ${parsed.client_email}`);
    } catch (e) {
      console.error('❌ Invalid JSON format');
      return false;
    }

    // 2. Check database connection
    console.log('\n2️⃣ Checking Database Connection...');
    const connection = await pool.getConnection();
    console.log('✅ Database connected');
    
    // 3. Check shopkeepers with tokens
    console.log('\n3️⃣ Checking Shopkeeper Tokens...');
    const [shopkeepers] = await connection.query(
      'SELECT id, name, shop_name, expo_push_token FROM shopkeepers WHERE expo_push_token IS NOT NULL LIMIT 10'
    );
    
    if (shopkeepers.length === 0) {
      console.warn('⚠️  No shopkeepers have push tokens');
      console.warn('   Shopkeepers need to login to the app to register tokens');
      connection.release();
      return false;
    }
    
    console.log(`✅ Found ${shopkeepers.length} shopkeeper(s) with tokens:`);
    shopkeepers.forEach((shop, index) => {
      const token = shop.expo_push_token;
      const tokenType = isFCMToken(token) ? 'FCM' : 'Expo';
      console.log(`\n   ${index + 1}. ${shop.shop_name} (ID: ${shop.id})`);
      console.log(`      Name: ${shop.name}`);
      console.log(`      Token Type: ${tokenType}`);
      console.log(`      Token: ${token.substring(0, 40)}...`);
    });

    // 4. Test FCM with first FCM token found
    console.log('\n4️⃣ Testing FCM Notification...');
    const fcmShopkeeper = shopkeepers.find(s => isFCMToken(s.expo_push_token));
    
    if (!fcmShopkeeper) {
      console.warn('⚠️  No FCM tokens found (only Expo tokens)');
      console.warn('   Shopkeeper app needs to be rebuilt with Firebase packages');
      connection.release();
      return false;
    }
    
    console.log(`\n📤 Sending test notification to: ${fcmShopkeeper.shop_name}`);
    console.log(`   Token: ${fcmShopkeeper.expo_push_token.substring(0, 40)}...`);
    
    const result = await sendFCMPush(
      fcmShopkeeper.expo_push_token,
      '🧪 Test Notification',
      'This is a test notification from the diagnostic script',
      { test: 'true', timestamp: new Date().toISOString() }
    );
    
    console.log('\n📊 FCM Result:');
    console.log(JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log('\n✅ Notification sent successfully!');
      console.log('   Check the shopkeeper app on the device');
    } else {
      console.error('\n❌ Notification failed');
      console.error('   Reason:', result.message);
      if (result.errors) {
        console.error('   Errors:', result.errors);
      }
    }
    
    connection.release();
    
    // 5. Summary
    console.log('\n' + '='.repeat(60));
    console.log('📋 DIAGNOSTIC SUMMARY\n');
    
    if (result.success) {
      console.log('✅ All systems operational!');
      console.log('\n🎯 If shopkeeper still doesn\'t receive notifications:');
      console.log('   1. Check device notification permissions');
      console.log('   2. Ensure app is in foreground or background (not killed)');
      console.log('   3. Check device Do Not Disturb settings');
      console.log('   4. Verify device has internet connection');
      console.log('   5. Try restarting the shopkeeper app');
    } else {
      console.log('❌ Issues detected:');
      if (!firebaseEnv) {
        console.log('   - Firebase credentials not configured');
      }
      if (shopkeepers.length === 0) {
        console.log('   - No shopkeeper tokens in database');
      }
      if (!fcmShopkeeper) {
        console.log('   - No FCM tokens (app needs Firebase packages)');
      }
      if (!result.success) {
        console.log('   - FCM send failed:', result.message);
      }
    }
    
    console.log('');
    return result.success;
    
  } catch (error) {
    console.error('\n❌ Diagnostic failed:', error.message);
    console.error(error.stack);
    return false;
  }
}

// Run diagnostic
diagnose()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
