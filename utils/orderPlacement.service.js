/**
 * Order Placement Service - Separated Functions for Performance
 * 
 * This module breaks down order placement into independent, parallelizable functions
 * to reduce total order placement time by executing non-blocking operations concurrently.
 * 
 * Architecture:
 * - Critical Path: Validation, DB operations (must be sequential in transaction)
 * - Parallel Path: Notifications, analytics, enrichment (can run after commit)
 * - Background Path: Heavy operations (queue for async processing)
 */

import pool from "../config/db.js";
import { sendExpoPush, sendFCMPush, isFCMToken } from "./expoPush.js";
import { onOrderCreated } from "../middleware/inventory.order.hooks.js";

// ============================================================================
// CRITICAL PATH - MUST RUN IN TRANSACTION (Sequential)
// ============================================================================

/**
 * Validate shopkeeper subscription status
 * CRITICAL: Must run before order creation
 */
export async function validateShopkeeperStatus(shopkeeperId, connection) {
  const [shopkeeperCheck] = await connection.execute(
    `SELECT id, subscription_status, is_deleted FROM shopkeepers WHERE id = ? LIMIT 1`,
    [shopkeeperId]
  );

  if (!shopkeeperCheck || shopkeeperCheck.length === 0) {
    throw {
      status: 404,
      code: "SHOP_NOT_FOUND",
      message: "Shopkeeper not found",
    };
  }

  const shopkeeper = shopkeeperCheck[0];

  if (shopkeeper.is_deleted) {
    throw {
      status: 400,
      code: "SHOP_DELETED",
      message: "This shop is no longer available",
    };
  }

  if (shopkeeper.subscription_status !== "active") {
    throw {
      status: 400,
      code: "SHOP_INACTIVE",
      message: `Shop is currently ${shopkeeper.subscription_status}. Cannot place orders.`,
      shopStatus: shopkeeper.subscription_status,
    };
  }

  return shopkeeper;
}

/**
 * Validate stock availability with row-level locking
 * CRITICAL: Must run in transaction to prevent race conditions
 */
export async function validateStockAvailability(items, shopkeeperId, connection) {
  const productIds = items.map((item) => item.productId || item.product_id);
  const placeholders = productIds.map(() => "?").join(",");

  const [products_check] = await connection.execute(
    `SELECT id, stock FROM products WHERE id IN (${placeholders}) AND shop_id = ? FOR UPDATE`,
    [...productIds, shopkeeperId]
  );

  // Validate stock for each item
  for (const item of items) {
    const productId = item.productId || item.product_id;
    const product = products_check.find((p) => p.id === productId);

    if (!product) {
      throw {
        status: 404,
        code: "PRODUCT_NOT_FOUND",
        message: `Product ${productId} not found`,
        productId,
      };
    }

    if (product.stock < item.quantity) {
      throw {
        status: 400,
        code: "INSUFFICIENT_STOCK",
        message: `Insufficient stock for product ${productId}`,
        productId,
        requestedQuantity: item.quantity,
        availableStock: product.stock,
      };
    }
  }

  return products_check;
}

/**
 * Validate wellness points usage
 * CRITICAL: Must run before deducting points
 */
export async function validatePointsUsage(
  creditsUsed,
  userId,
  totalAmount,
  connection
) {
  if (creditsUsed <= 0) {
    return { valid: true, pointsDiscount: 0 };
  }

  const [[user]] = await connection.execute(
    "SELECT store_credits FROM users WHERE id = ?",
    [userId]
  );

  if (!user) {
    throw {
      status: 404,
      message: "User not found",
    };
  }

  const availablePoints = user.store_credits || 0;
  const maxAllowed = Math.floor((totalAmount / 0.05) * 0.3); // 30% of order value

  if (creditsUsed > availablePoints) {
    throw {
      status: 400,
      message: "Insufficient points available",
    };
  }

  if (creditsUsed > maxAllowed) {
    throw {
      status: 400,
      message: `Maximum ${maxAllowed} points allowed (30% of order value)`,
    };
  }

  const pointsDiscount = creditsUsed * 0.05; // ₹0.05 per point
  return { valid: true, pointsDiscount };
}

/**
 * Deduct wellness points from user account
 * CRITICAL: Must run in transaction
 */
export async function deductWellnessPoints(connection, userId, creditsUsed) {
  await connection.execute(
    "UPDATE users SET store_credits = COALESCE(store_credits, 0) - ? WHERE id = ?",
    [creditsUsed, userId]
  );

  return { discountAmount: creditsUsed * 0.05 };
}

/**
 * Create order record in database
 * CRITICAL: Must run in transaction
 */
export async function createOrderRecord(
  connection,
  orderId,
  userId,
  shopkeeperId,
  paymentMethod,
  finalTotal,
  creditsEarned,
  creditsUsed,
  deliveryAddress,
  latitude,
  longitude,
  hasTimer,
  pickupCode,
  timerStartedAt,
  timerExpiresAt,
  deliveryType,
  scheduledTime
) {
  await connection.execute(
    `
    INSERT INTO orders (
      id, user_id, shopkeeper_id, status, payment_method,
      total_amount, credits_earned, credits_used,
      delivery_address, latitude, longitude,
      has_timer, pickup_code, timer_started_at, timer_expires_at,
      order_type, delivery_mode, scheduled_time, created_at
    ) VALUES (?, ?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `,
    [
      orderId,
      userId,
      shopkeeperId,
      paymentMethod,
      finalTotal,
      creditsEarned,
      creditsUsed,
      deliveryAddress,
      latitude,
      longitude,
      hasTimer,
      pickupCode,
      timerStartedAt,
      timerExpiresAt,
      deliveryType === "store_pickup" || deliveryType === "pickup"
        ? "pickup"
        : "delivery",
      deliveryType === "store_pickup" || deliveryType === "pickup"
        ? "pickup"
        : "delivery",
      scheduledTime,
    ]
  );

  return orderId;
}

/**
 * Create order items in database
 * CRITICAL: Must run in transaction
 */
export async function createOrderItems(connection, orderId, items) {
  for (const item of items) {
    const productId = item.productId || item.product_id;
    const quantity = item.quantity || item.qty || 1;
    const price = item.price || 0;

    if (!productId) {
      console.warn("Skipping item with missing productId", item);
      continue;
    }

    const [maxItemId] = await connection.execute(
      "SELECT COALESCE(MAX(id), 0) + 1 as nextId FROM order_items"
    );
    const itemId = maxItemId[0].nextId;

    await connection.execute(
      `INSERT INTO order_items (id, order_id, product_id, quantity, price)
       VALUES (?, ?, ?, ?, ?)`,
      [itemId, orderId, productId, quantity, price]
    );

    // Reduce stock
    await connection.execute(
      `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`,
      [quantity, productId, quantity]
    );
  }
}

/**
 * Create timer record for pickup orders
 * CRITICAL: Must run in transaction
 */
export async function createTimerRecord(
  connection,
  orderId,
  pickupCode,
  timerDuration,
  timerStartedAt,
  timerExpiresAt
) {
  try {
    await connection.execute(
      `INSERT INTO order_timers (order_id, pickup_code, timer_duration, timer_started_at, timer_expires_at, is_active)
       VALUES (?, ?, ?, ?, ?, TRUE)`,
      [orderId, pickupCode, timerDuration, timerStartedAt, timerExpiresAt]
    );
  } catch (error) {
    console.warn("Timer record creation failed:", error.message);
  }
}

// ============================================================================
// PARALLEL PATH - CAN RUN AFTER COMMIT (Non-blocking)
// ============================================================================

/**
 * Fetch shopkeeper details for notifications and broadcasting
 * Can run in parallel after order commit
 */
export async function fetchShopkeeperDetails(shopkeeperId) {
  const conn = await pool.getConnection();
  try {
    const [shopkeeperDetails] = await conn.execute(
      `SELECT shop_name, name, phone, address, latitude, longitude, expo_push_token 
       FROM shopkeepers WHERE id = ?`,
      [shopkeeperId]
    );
    return shopkeeperDetails[0] || {};
  } finally {
    conn.release();
  }
}

/**
 * Fetch customer details for notifications
 * Can run in parallel after order commit
 */
export async function fetchCustomerDetails(userId) {
  const conn = await pool.getConnection();
  try {
    const [customerDetails] = await conn.execute(
      `SELECT expo_push_token FROM users WHERE id = ?`,
      [userId]
    );
    return customerDetails[0] || {};
  } finally {
    conn.release();
  }
}

/**
 * Fetch product details for order items
 * Can run in parallel after order commit
 * Batched to avoid N+1 queries
 */
export async function fetchProductDetails(productIds) {
  if (!productIds || productIds.length === 0) {
    return [];
  }

  const conn = await pool.getConnection();
  try {
    const placeholders = productIds.map(() => "?").join(",");
    const [products] = await conn.execute(
      `SELECT id, name, image, category FROM products WHERE id IN (${placeholders})`,
      productIds
    );
    return products;
  } finally {
    conn.release();
  }
}

/**
 * Send push notification to shopkeeper
 * Can run in parallel after order commit
 */
export async function sendShopkeeperNotification(
  shopkeeper,
  orderId,
  shopkeeperId,
  finalTotal
) {
  if (!shopkeeper?.expo_push_token) {
    return { success: false, reason: "No push token" };
  }

  try {
    const token = shopkeeper.expo_push_token;
    const title = "📦 New Order Received!";
    const body = `You have a new order (#${orderId}) worth ₹${finalTotal.toFixed(2)}.`;
    const payload = { orderId: String(orderId), shopId: String(shopkeeperId) };

    if (isFCMToken(token)) {
      await sendFCMPush(token, title, body, payload);
    } else {
      await sendExpoPush(token, title, body, payload);
    }

    console.log(`✅ Push notification sent to shopkeeper ${shopkeeperId}`);
    return { success: true };
  } catch (error) {
    console.error(
      `⚠️ Failed to send push to shopkeeper ${shopkeeperId}:`,
      error.message
    );
    return { success: false, error: error.message };
  }
}

/**
 * Send push notification to customer
 * Can run in parallel after order commit
 */
export async function sendCustomerNotification(customer, orderId, userId) {
  if (!customer?.expo_push_token) {
    return { success: false, reason: "No push token" };
  }

  try {
    const token = customer.expo_push_token;
    const title = "Order Placed Successfully!";
    const body = `Your order #${orderId} has been placed. You can track it in the app.`;
    const payload = { orderId: String(orderId), status: "Pending" };

    if (isFCMToken(token)) {
      await sendFCMPush(token, title, body, payload);
    } else {
      await sendExpoPush(token, title, body, payload);
    }

    console.log(`✅ Push notification sent to customer ${userId}`);
    return { success: true };
  } catch (error) {
    console.error(
      `⚠️ Failed to send push to customer ${userId}:`,
      error.message
    );
    return { success: false, error: error.message };
  }
}

/**
 * Award wellness points to customer
 * Can run in parallel after order commit
 */
export async function awardWellnessPoints(userId, finalTotal, orderId) {
  try {
    const pointsToAward = Math.floor(finalTotal * 0.01);

    if (pointsToAward > 0) {
      const conn = await pool.getConnection();
      try {
        await conn.execute(
          "UPDATE users SET store_credits = COALESCE(store_credits, 0) + ? WHERE id = ?",
          [pointsToAward, userId]
        );
        console.log(
          `✅ Awarded ${pointsToAward} wellness points to user ${userId} for order ${orderId}`
        );
      } finally {
        conn.release();
      }
    }

    return { success: true, pointsAwarded: pointsToAward };
  } catch (error) {
    console.error(`❌ Error awarding wellness points:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Log order analytics
 * Can run in parallel after order commit
 */
export async function logOrderAnalytics(orderId, userId, shopkeeperId, finalTotal) {
  try {
    console.log(
      `📊 Order Analytics - Order: ${orderId}, User: ${userId}, Shop: ${shopkeeperId}, Amount: ₹${finalTotal}`
    );
    return { success: true };
  } catch (error) {
    console.error(`❌ Error logging analytics:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Enrich order items with product details
 * Can run in parallel after order commit
 */
export async function enrichOrderItems(items, productDetails) {
  return items.map((item) => {
    const productId = item.productId || item.product_id;
    const quantity = item.quantity || item.qty || 1;
    const price = item.price || 0;

    const product = productDetails.find((p) => p.id === productId) || {};

    return {
      productId: productId,
      productName: product.name || "Unknown Product",
      productImage: product.image || null,
      productCategory: product.category || null,
      quantity: quantity,
      price: parseFloat(price) || 0,
    };
  });
}

/**
 * Execute all parallel tasks after order commit
 * Returns immediately without blocking response
 */
export async function executeParallelTasks(
  orderId,
  userId,
  shopkeeperId,
  finalTotal,
  items,
  io
) {
  // Start all parallel tasks without waiting
  Promise.allSettled([
    // Task 1: Fetch shopkeeper details and send notification
    (async () => {
      try {
        const shopkeeper = await fetchShopkeeperDetails(shopkeeperId);
        await sendShopkeeperNotification(
          shopkeeper,
          orderId,
          shopkeeperId,
          finalTotal
        );
      } catch (err) {
        console.error(`❌ Shopkeeper notification failed:`, err.message);
      }
    })(),

    // Task 2: Fetch customer details and send notification
    (async () => {
      try {
        const customer = await fetchCustomerDetails(userId);
        await sendCustomerNotification(customer, orderId, userId);
      } catch (err) {
        console.error(`❌ Customer notification failed:`, err.message);
      }
    })(),

    // Task 3: Award wellness points
    (async () => {
      try {
        await awardWellnessPoints(userId, finalTotal, orderId);
      } catch (err) {
        console.error(`❌ Wellness points award failed:`, err.message);
      }
    })(),

    // Task 4: Log analytics
    (async () => {
      try {
        await logOrderAnalytics(orderId, userId, shopkeeperId, finalTotal);
      } catch (err) {
        console.error(`❌ Analytics logging failed:`, err.message);
      }
    })(),

    // Task 5: Fetch product details and broadcast
    (async () => {
      try {
        const productIds = items.map(
          (item) => item.productId || item.product_id
        );
        const productDetails = await fetchProductDetails(productIds);
        const enrichedItems = await enrichOrderItems(items, productDetails);

        // Broadcast to shopkeeper room
        if (io) {
          io.to(`shop_${shopkeeperId}`).emit("new_order", {
            orderId,
            items: enrichedItems,
            totalAmount: finalTotal,
          });
        }
      } catch (err) {
        console.error(`❌ Broadcasting failed:`, err.message);
      }
    })(),
  ]).catch((err) => {
    console.error(`❌ Unexpected error in parallel tasks:`, err);
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate next order ID
 */
export async function generateOrderId(connection) {
  const [maxOrderId] = await connection.execute(
    "SELECT COALESCE(MAX(id), 0) + 1 as nextId FROM orders"
  );
  return maxOrderId[0].nextId;
}

/**
 * Generate pickup code
 */
export function generatePickupCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Calculate timer timestamps
 */
export function calculateTimerTimestamps(hasTimer, timerDurationSeconds) {
  if (!hasTimer) {
    return { timerStartedAt: null, timerExpiresAt: null };
  }

  const now = new Date();
  const timerStartedAt = now.toISOString().slice(0, 19).replace("T", " ");
  const timerExpiresAt = new Date(now.getTime() + timerDurationSeconds * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

  return { timerStartedAt, timerExpiresAt };
}

/**
 * Calculate credits earned
 */
export function calculateCreditsEarned(finalTotal) {
  return Math.floor(finalTotal * 0.01); // 1% of order amount
}
