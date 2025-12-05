import admin from 'firebase-admin';

// Initialize Firebase Admin SDK
let firebaseApp = null;

const initializeFirebase = () => {
  if (firebaseApp) return firebaseApp;

  try {
    // For production, use service account key
    // For development, you can use the default credentials
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: 'nexkirana-c9da5'
      });
    } else {
      // Fallback for development - you'll need to set up Application Default Credentials
      console.log('⚠️ Using default Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT_KEY for production.');
      firebaseApp = admin.initializeApp({
        projectId: 'nexkirana-c9da5'
      });
    }
    
    console.log('✅ Firebase Admin SDK initialized successfully');
    return firebaseApp;
  } catch (error) {
    console.error('❌ Firebase Admin SDK initialization failed:', error.message);
    return null;
  }
};

// Send FCM notification
export const sendFCMNotification = async (tokens, title, body, data = {}) => {
  try {
    const app = initializeFirebase();
    if (!app) {
      throw new Error('Firebase not initialized');
    }

    const tokenList = Array.isArray(tokens) ? tokens : [tokens];
    const validTokens = tokenList.filter(token => token && typeof token === 'string');

    if (validTokens.length === 0) {
      return { success: false, message: 'No valid tokens provided' };
    }

    const message = {
      notification: {
        title,
        body
      },
      data: {
        ...data,
        timestamp: Date.now().toString()
      },
      tokens: validTokens
    };

    const response = await admin.messaging().sendMulticast(message);
    
    console.log('FCM notification sent:', {
      successCount: response.successCount,
      failureCount: response.failureCount
    });

    // Handle failed tokens
    const failedTokens = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        failedTokens.push(validTokens[idx]);
        console.error('FCM send failed for token:', validTokens[idx], resp.error);
      }
    });

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      failedTokens
    };
  } catch (error) {
    console.error('FCM notification error:', error);
    return { success: false, message: error.message };
  }
};

// Send to topic
export const sendFCMToTopic = async (topic, title, body, data = {}) => {
  try {
    const app = initializeFirebase();
    if (!app) {
      throw new Error('Firebase not initialized');
    }

    const message = {
      notification: {
        title,
        body
      },
      data: {
        ...data,
        timestamp: Date.now().toString()
      },
      topic
    };

    const response = await admin.messaging().send(message);
    console.log('FCM topic notification sent:', response);

    return { success: true, messageId: response };
  } catch (error) {
    console.error('FCM topic notification error:', error);
    return { success: false, message: error.message };
  }
};

export default { sendFCMNotification, sendFCMToTopic };