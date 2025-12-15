import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Firebase Admin SDK
let firebaseInitialized = false;

function initializeFirebase() {
  if (firebaseInitialized) return;
  
  try {
    // Check if already initialized
    if (admin.apps.length > 0) {
      firebaseInitialized = true;
      return;
    }

    // Initialize with service account or default credentials
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      : null;

    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } else {
      // Use application default credentials
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    }
    
    firebaseInitialized = true;
    console.log('Firebase Admin SDK initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error);
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
    return { success: false, message: 'No tokens provided' };
  }

  initializeFirebase();

  if (!firebaseInitialized) {
    console.warn('Firebase not initialized, skipping FCM push');
    return { success: false, message: 'Firebase not initialized' };
  }

  const tokenList = Array.isArray(tokens) ? tokens : [tokens];
  const validTokens = tokenList.filter(t => t && typeof t === 'string' && t.length > 0);

  if (validTokens.length === 0) {
    return { success: false, message: 'No valid tokens provided' };
  }

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
            },
          },
        };

        await admin.messaging().send(message);
        results.successCount++;
      } catch (error) {
        results.failureCount++;
        
        // Check for invalid token errors
        if (
          error.code === 'messaging/invalid-registration-token' ||
          error.code === 'messaging/registration-token-not-registered'
        ) {
          results.invalidTokens.push(token);
        }
        
        results.errors.push({
          token,
          error: error.message,
          code: error.code,
        });
      }
    }

    results.success = results.successCount > 0;
    return results;
  } catch (error) {
    console.error('FCM push error:', error);
    return {
      success: false,
      message: error.message,
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

export default { sendFCMPush, isFCMToken };
