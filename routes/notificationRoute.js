import express from "express";
import { sendExpoPush } from "../utils/expoPush.js";
import pool from "../config/db.js";

const notificationRouter = express.Router();

// POST /send
notificationRouter.post("/send", async (req, res) => {
  try {
    const { token, title, body, targetTable, targetId } = req.body;
    if (!token || !title || !body) return res.status(400).json({ success: false, message: "token, title and body required" });

    const result = await sendExpoPush(token, title, body, req.body.data || {});

    // optional cleanup: if invalid tokens returned and caller provided target table+id, clear token field
    if (result?.invalidTokens && result.invalidTokens.length && targetTable && targetId) {
      // only allow safe tables / columns
      const allowedTables = {
        users: "expo_push_token",
        shopkeepers: "expo_push_token",
      };
      const column = allowedTables[targetTable];
      if (column) {
        await pool.query(`UPDATE ${targetTable} SET ${column} = NULL WHERE id = ? AND ${column} IN (?)`, [targetId, result.invalidTokens]);
      }
    }

    res.json({ success: true, result });
  } catch (err) {
    console.error("Notification send error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default notificationRouter;
