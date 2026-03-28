import { Expo } from "expo-server-sdk";
import pool from "../config/db.js"; // Import the database pool

// Replaces previous implementation with full expo-server-sdk usage

const expo = new Expo();

/**
 * Send push notifications via Expo.
 * @param {string|string[]} tokens - single token or array of Expo push tokens
 * @param {string} title
 * @param {string} body
 * @param {object} data - optional payload data
 * @returns {object} result with tickets, receipts, invalidTokens, nonExpoTokens, errors
 */
export async function sendExpoPush(tokens, title, body, data = {}) {
  if (!tokens) return { success: false, message: "No tokens provided" };

  const tokenList = Array.isArray(tokens) ? tokens : [tokens];
  const messages = [];
  const nonExpoTokens = [];
  for (const token of tokenList) {
    if (!token) continue;
    if (!Expo.isExpoPushToken(token)) {
      nonExpoTokens.push(token);
      continue;
    }
    messages.push({
      to: token,
      sound: "default",
      title,
      body,
      data,
    });
  }

  const tickets = []; // collect tickets returned by sendPushNotificationsAsync
  const tokenToTicket = {}; // map token -> ticket id (if provided)
  const errors = [];

  try {
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const chunkTickets = await expo.sendPushNotificationsAsync(chunk);
        // chunk order matches messages in that chunk
        tickets.push(...chunkTickets);
        // map tokens in chunk to ticket ids where available
        for (let i = 0; i < chunk.length; i++) {
          const msg = chunk[i];
          const ticket = chunkTickets[i];
          if (ticket && ticket.id) {
            tokenToTicket[msg.to] = ticket.id;
          } else if (ticket && ticket.status === "error") {
            errors.push({ token: msg.to, detail: ticket });
          }
        }
      } catch (sendErr) {
        console.error("sendPushNotificationsAsync error:", sendErr);
        errors.push({ chunkError: sendErr?.message || sendErr });
      }
    }

    // gather receipt ids
    const receiptIds = Object.values(tokenToTicket).filter(Boolean);
    const receipts = {};
    const invalidTokens = new Set();

    if (receiptIds.length > 0) {
      const receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);
      for (const receiptIdChunk of receiptIdChunks) {
        try {
          const chunkReceipts =
            await expo.getPushNotificationReceiptsAsync(receiptIdChunk);
          Object.assign(receipts, chunkReceipts);
        } catch (receiptErr) {
          console.error("getPushNotificationReceiptsAsync error:", receiptErr);
          errors.push({ receiptError: receiptErr?.message || receiptErr });
        }
      }

      // inspect receipts for errors / invalid tokens
      for (const [token, ticketId] of Object.entries(tokenToTicket)) {
        const receipt = receipts[ticketId];
        if (!receipt) continue;
        if (receipt.status === "ok") continue;
        // status === 'error'
        const detail = receipt.details || {};
        // common errors: "DeviceNotRegistered", "InvalidCredentials", etc.
        if (receipt.message) {
          errors.push({
            token,
            ticketId,
            message: receipt.message,
            details: detail,
          });
        }
        if (detail && detail.error) {
          // mark token for removal if device not registered or invalid
          const errCode = detail.error;
          if (
            errCode === "DeviceNotRegistered" ||
            errCode === "InvalidCredentials"
          ) {
            invalidTokens.add(token);
            // Asynchronously remove the invalid token
            removeInvalidToken(token).catch((removeError) => {
              console.error(
                "❌ Failed to remove invalid Expo token:",
                removeError
              );
            });
          }
        }
      }
    }

    return {
      success: true,
      tickets,
      receipts,
      tokenToTicket,
      nonExpoTokens,
      invalidTokens: Array.from(invalidTokens),
      errors,
    };
  } catch (err) {
    console.error("sendExpoPush fatal error:", err);
    return {
      success: false,
      message: err?.message || "Unknown error",
      errors: [err],
    };
  }
}

// Helper: convenience wrapper for single-token quick send (returns same shape)
export async function sendExpoPushToToken(token, title, body, data = {}) {
  return sendExpoPush(token, title, body, data);
}

// NEW: export validator for token format so routes can quickly validate
export function isExpoPushToken(token) {
  return Expo.isExpoPushToken(token);
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
      console.log(
        `✅ Removed invalid Expo token from ${userResult.affectedRows} user(s)`
      );
    }

    // Remove from shopkeepers table
    const [shopkeeperResult] = await pool.query(
      "UPDATE shopkeepers SET expo_push_token = NULL WHERE expo_push_token = ?",
      [token]
    );
    if (shopkeeperResult.affectedRows > 0) {
      console.log(
        `✅ Removed invalid Expo token from ${shopkeeperResult.affectedRows} shopkeeper(s)`
      );
    }
  } catch (dbError) {
    console.error(
      `Database error while removing invalid Expo token: ${dbError.message}`
    );
  }
}
