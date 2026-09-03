import admin from "firebase-admin";

// Initialize Firebase Admin SDK
let firebaseApp = null;

const initializeFirebase = () => {
  if (firebaseApp) return firebaseApp;

  try {
    // Service account key from env (single-line JSON)
    // MUST belong to the SAME Firebase project as the mobile apps (zeu-mobile,
    // sender 50454345450) or FCM sends fail with "SenderId mismatch".
    const serviceAccountJson =
      process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
      process.env.FIREBASE_SERVICE_ACCOUNT;

    if (serviceAccountJson) {
      const serviceAccount = JSON.parse(serviceAccountJson);
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
      console.log(
        `✅ Firebase Admin SDK initialized for project: ${serviceAccount.project_id}`
      );
    } else {
      // Expected Firebase project of the mobile apps — used for a loud misconfig check
      const expectedProject =
        process.env.FIREBASE_PROJECT_ID || "zeu-mobile";
      console.warn(
        "⚠️ FIREBASE_SERVICE_ACCOUNT_KEY not set. Set it to the service account of the SAME Firebase project as the mobile apps, or FCM sends will fail."
      );
      firebaseApp = admin.initializeApp({
        projectId: expectedProject,
      });
    }

    return firebaseApp;
  } catch (error) {
    console.error(
      "❌ Firebase Admin SDK initialization failed:",
      error.message
    );
    return null;
  }
};

// Send FCM notification
export const sendFCMNotification = async (tokens, title, body, data = {}) => {
  try {
    const app = initializeFirebase();
    if (!app) {
      throw new Error("Firebase not initialized");
    }

    const tokenList = Array.isArray(tokens) ? tokens : [tokens];
    const validTokens = tokenList.filter(
      (token) => token && typeof token === "string"
    );

    if (validTokens.length === 0) {
      return { success: false, message: "No valid tokens provided" };
    }

    const message = {
      notification: {
        title,
        body,
      },
      data: {
        ...data,
        timestamp: Date.now().toString(),
      },
      tokens: validTokens,
    };

    const response = await admin.messaging().sendMulticast(message);

    console.log("FCM notification sent:", {
      successCount: response.successCount,
      failureCount: response.failureCount,
    });

    // Handle failed tokens
    const failedTokens = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        failedTokens.push(validTokens[idx]);
        console.error(
          "FCM send failed for token:",
          validTokens[idx],
          resp.error
        );
      }
    });

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      failedTokens,
    };
  } catch (error) {
    console.error("FCM notification error:", error);
    return { success: false, message: error.message };
  }
};

// Send to topic
export const sendFCMToTopic = async (topic, title, body, data = {}) => {
  try {
    const app = initializeFirebase();
    if (!app) {
      throw new Error("Firebase not initialized");
    }

    const message = {
      notification: {
        title,
        body,
      },
      data: {
        ...data,
        timestamp: Date.now().toString(),
      },
      topic,
    };

    const response = await admin.messaging().send(message);
    console.log("FCM topic notification sent:", response);

    return { success: true, messageId: response };
  } catch (error) {
    console.error("FCM topic notification error:", error);
    return { success: false, message: error.message };
  }
};

export default { sendFCMNotification, sendFCMToTopic };
