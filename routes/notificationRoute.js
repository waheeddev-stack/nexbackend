import express from "express";
import { sendExpoPush } from "../utils/expoPush.js";
import { sendFCMNotification, sendFCMToTopic } from "../config/firebase.js";
import pool from "../config/db.js";

const notificationRouter = express.Router();

// POST /send - Send notification (supports both Expo and FCM)
notificationRouter.post("/send", async (req, res) => {
  try {
    const {
      token,
      title,
      body,
      targetTable,
      targetId,
      type = "expo",
    } = req.body;
    if (!token || !title || !body)
      return res
        .status(400)
        .json({ success: false, message: "token, title and body required" });

    let result;

    if (type === "fcm") {
      // Use Firebase Cloud Messaging
      result = await sendFCMNotification(
        token,
        title,
        body,
        req.body.data || {}
      );
    } else {
      // Use Expo Push Notifications (default)
      result = await sendExpoPush(token, title, body, req.body.data || {});
    }

    // optional cleanup: if invalid tokens returned and caller provided target table+id, clear token field
    if (
      result?.invalidTokens &&
      result.invalidTokens.length &&
      targetTable &&
      targetId
    ) {
      // only allow safe tables / columns
      const allowedTables = {
        users: "expo_push_token",
        shopkeepers: "expo_push_token",
      };
      const column = allowedTables[targetTable];
      if (column) {
        await pool.query(
          `UPDATE ${targetTable} SET ${column} = NULL WHERE id = ? AND ${column} IN (?)`,
          [targetId, result.invalidTokens]
        );
      }
    }

    res.json({ success: true, result });
  } catch (err) {
    console.error("Notification send error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /send-fcm - Send FCM notification specifically
notificationRouter.post("/send-fcm", async (req, res) => {
  try {
    const { tokens, title, body, data } = req.body;
    if (!tokens || !title || !body) {
      return res
        .status(400)
        .json({ success: false, message: "tokens, title and body required" });
    }

    const result = await sendFCMNotification(tokens, title, body, data || {});
    res.json({ success: true, result });
  } catch (err) {
    console.error("FCM notification send error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /send-topic - Send to FCM topic
notificationRouter.post("/send-topic", async (req, res) => {
  try {
    const { topic, title, body, data } = req.body;
    if (!topic || !title || !body) {
      return res
        .status(400)
        .json({ success: false, message: "topic, title and body required" });
    }

    const result = await sendFCMToTopic(topic, title, body, data || {});
    res.json({ success: true, result });
  } catch (err) {
    console.error("FCM topic notification send error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default notificationRouter;
