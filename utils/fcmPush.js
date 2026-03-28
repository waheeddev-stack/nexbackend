import admin from 'firebase-admin';
import dotenv from 'dotenv';
import pool from '../config/db.js'; // Import the database pool

dotenv.config();

// Initialize Firebase Admin SDK
let firebaseInitialized = false;

function initializeFirebase() {
  if (firebaseInitialized) return;
  
  try {
    // Check if already initialized
    if (admin.apps.length > 0) {
      firebaseInitialized = true;
      console.log('✅ Firebase Admin SDK already initialized');
      return;
    }

    // Initialize with service account or default credentials
    // Check both FIREBASE_SERVICE_ACCOUNT and FIREBASE_SERVICE_ACCOUNT_KEY
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    
    if (!serviceAccountJson) {
      console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT environment variable not set');
      console.warn('⚠️ Attempting to use application default credentials');
    }
    
    const serviceAccount = serviceAccountJson ? JSON.parse(serviceAccountJson) : null;

    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('✅ Firebase Admin SDK initialized with service account');
    } else {
      // Use application default credentials
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
      console.log('✅ Firebase Admin SDK initialized with application default credentials');
    }
    
    firebaseInitialized = true;
  } catch (error) {
    console.error('❌ Failed to initialize Firebase Admin SDK:', error.message);
    console.error('Error details:', error);
    firebaseInitialized = false;
  }
}

/**
 * Send push notification via Firebase Cloud Messaging
 * @param {string|string[]} tokens - FCM token(s)
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Optional data payload
 * @returns {object} result with success status and details
 */
export async function sendFCMPush(tokens, title, body, data = {}) {
  if (!tokens) {
    console.warn('FCM: No tokens provided');
    return { success: false, message: 'No tokens provided', successCount: 0, failureCount: 0, invalidTokens: [], errors: [] };
  }

  initializeFirebase();

  if (!firebaseInitialized) {
    console.warn('Firebase not initialized, skipping FCM push');
    console.warn('Make sure FIREBASE_SERVICE_ACCOUNT environment variable is set');
    return { success: false, message: 'Firebase not initialized', successCount: 0, failureCount: 0, invalidTokens: [], errors: [] };
  }

  const tokenList = Array.isArray(tokens) ? tokens : [tokens];
  const validTokens = tokenList.filter(t => t && typeof t === 'string' && t.length > 0);

  if (validTokens.length === 0) {
    console.warn('FCM: No valid tokens after filtering');
    return { success: false, message: 'No valid tokens provided', successCount: 0, failureCount: 0, invalidTokens: [], errors: [] };
  }

  console.log(`📤 FCM: Sending notification to ${validTokens.length} token(s)`);
  console.log(`📧 Title: "${title}"`);
  console.log(`📝 Body: "${body}"`);

  const results = {
    success: true,
    successCount: 0,
    failureCount: 0,
    invalidTokens: [],
    errors: [],
  };

  try {
    // Send to each token individually for better error tracking
    for (const token of validTokens) {
      try {
        const message = {
          token,
          notification: {
            title,
            body,
          },
          data: {
            ...data,
            // Convert all data values to strings (FCM requirement)
            ...(data.orderId && { orderId: String(data.orderId) }),
            ...(data.shopId && { shopId: String(data.shopId) }),
            ...(data.status && { status: String(data.status) }),
          },
          android: {
            priority: 'high',
            notification: {
              sound: 'default',
              channelId: 'orders',
              priority: 'high',
              defaultSound: true,
              defaultVibrateTimings: true,
            },
          },
          apns: {
            payload: {
              aps: {
                sound: 'default',
                badge: 1,
              },
            },
          },
        };

        const response = await admin.messaging().send(message);
        results.successCount++;
        console.log(`✅ FCM: Notification sent successfully to token: ${token.substring(0, 20)}...`);
        console.log(`Response:`, response);
      } catch (error) {
        results.failureCount++;
        console.error(`❌ FCM: Failed to send to token: ${token.substring(0, 20)}...`);
        console.error(`Error code: ${error.code}`);
        console.error(`Error message: ${error.message}`);
        
        // Check for invalid token errors
        if (
          error.code === 'messaging/invalid-registration-token' ||
          error.code === 'messaging/registration-token-not-registered'
        ) {
          results.invalidTokens.push(token);
          console.warn(`⚠️ FCM: Invalid token detected, removing from database...`);
          // Asynchronously remove the invalid token from both users and shopkeepers tables
          removeInvalidToken(token).catch(removeError => {
            console.error('❌ Failed to remove invalid token:', removeError);
          });
        }
        
        results.errors.push({
          token: token.substring(0, 20) + '...',
          error: error.message,
          code: error.code,
        });
      }
    }

    results.success = results.successCount > 0;
    
    console.log(`📊 FCM Results: ${results.successCount} success, ${results.failureCount} failed`);
    if (results.invalidTokens.length > 0) {
      console.log(`⚠️ Invalid tokens: ${results.invalidTokens.length}`);
    }
    
    return results;
  } catch (error) {
    console.error('❌ FCM push error:', error);
    return {
      success: false,
      message: error.message,
      successCount: 0,
      failureCount: validTokens.length,
      invalidTokens: [],
      errors: [error],
    };
  }
}

/**
 * Check if a token looks like an FCM token (not Expo)
 * @param {string} token 
 * @returns {boolean}
 */
export function isFCMToken(token) {
  if (!token || typeof token !== 'string') return false;
  // Expo tokens start with "ExponentPushToken["
  // FCM tokens are long alphanumeric strings
  return !token.startsWith('ExponentPushToken[') && token.length > 50;
}

/**
 * Removes an invalid push token from the database.
 * @param {string} token - The invalid token to remove.
 */
async function removeInvalidToken(token) {
  if (!token) return;
  try {
    // Remove from users table
    const [userResult] = await pool.query(
      "UPDATE users SET expo_push_token = NULL WHERE expo_push_token = ?",
      [token]
    );
    if (userResult.affectedRows > 0) {
      console.log(`✅ Removed invalid token from ${userResult.affectedRows} user(s)`);
    }

    // Remove from shopkeepers table
    const [shopkeeperResult] = await pool.query(
      "UPDATE shopkeepers SET expo_push_token = NULL WHERE expo_push_token = ?",
      [token]
    );
    if (shopkeeperResult.affectedRows > 0) {
      console.log(`✅ Removed invalid token from ${shopkeeperResult.affectedRows} shopkeeper(s)`);
    }
  } catch (dbError) {
    console.error(`Database error while removing invalid token: ${dbError.message}`);
  }
}

export default { sendFCMPush, isFCMToken };
