import express from "express";
import verifyToken from "../middleware/auth.js";
import {
  handleOrderTokenExpiration,
  handleCartTokenExpiration,
  orderErrorHandler,
} from "../middleware/orderErrorHandler.js";
import { refreshTokenIfNeeded } from "../middleware/tokenRefresh.js";
import pool from "../config/db.js";
import {
  validateStockAvailability,
  onOrderCreated,
} from "../middleware/inventory.order.hooks.js";
import {
  TIMER_DURATION_SECONDS,
  TIME_SLOT_CONFIG,
  calculateDeliverySlots,
  getSlotForTimestamp,
} from "../config/constants.js";
import {
  validatePointsUsage,
  deductWellnessPoints,
  awardWellnessPoints,
} from "../utils/wellnessPoints.js";
import { sendExpoPush } from "../utils/expoPush.js";
import { sendFCMPush, isFCMToken } from "../utils/fcmPush.js";
import { restoreStockForCancelledOrder } from "../utils/stockManager.js";
import {
  getCachedShopkeeper,
  getCachedProduct,
  getCachedUser,
  invalidateProductCache,
  invalidateUserCache,
  prefetchOrderData,
  startBackgroundRefresh,
} from "../services/orderPrefetch.service.js";

const router = express.Router();

// Start background refresh when module loads
startBackgroundRefresh();

// ============================================================================
// CRITICAL FIX #9: Background Task Error Handling Helper
// ============================================================================
/**
 * Execute background tasks without blocking order response
 * All errors are caught and logged, never thrown
 */
async function executeBackgroundTasksAsync(orderId, userId, shopkeeperId, finalTotal, connection) {
  try {
    // Execute all background tasks in parallel with error handling
    const tasks = [
      // Task 1: Send notifications (non-blocking)
      sendNotificationsAsync(orderId, userId, shopkeeperId, finalTotal, connection)
        .catch(err => {
          console.error(`❌ Failed to send notifications for order ${orderId}:`, err.message);
          return { success: false, task: 'notifications', error: err.message };
        }),
      
      // Task 2: Award wellness points (non-blocking)
      awardWellnessPointsAsync(userId, finalTotal, orderId)
        .catch(err => {
          console.error(`❌ Failed to award wellness points for order ${orderId}:`, err.message);
          return { success: false, task: 'wellness_points', error: err.message };
        }),
      
      // Task 3: Log order analytics (non-blocking)
      logOrderAnalyticsAsync(orderId, userId, shopkeeperId, finalTotal)
        .catch(err => {
          console.error(`❌ Failed to log order analytics for order ${orderId}:`, err.message);
          return { success: false, task: 'analytics', error: err.message };
        })
    ];

    // Execute all tasks in parallel, don't wait for them
    Promise.allSettled(tasks).then((results) => {
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      console.log(`✅ Background tasks for order ${orderId}: ${succeeded} succeeded, ${failed} failed`);
    }).catch(err => {
      console.error(`❌ Unexpected error in background task execution for order ${orderId}:`, err);
    });
  } catch (err) {
    console.error(`❌ Failed to start background tasks for order ${orderId}:`, err);
    // Don't throw - background tasks should never block order placement
  }
}

/**
 * Send push notifications to shopkeeper and customer
 */
async function sendNotificationsAsync(orderId, userId, shopkeeperId, finalTotal, connection) {
  try {
    // Get shopkeeper details
    const [shopkeeperRows] = await connection.execute(
      "SELECT expo_push_token FROM shopkeepers WHERE id = ?",
      [shopkeeperId]
    );
    const shopkeeper = shopkeeperRows[0];

    // Send to shopkeeper
    if (shopkeeper?.expo_push_token) {
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
      } catch (pushErr) {
        console.error(`⚠️ Failed to send push to shopkeeper ${shopkeeperId}:`, pushErr.message);
      }
    }

    // Get customer details
    const [customerRows] = await connection.execute(
      "SELECT expo_push_token FROM users WHERE id = ?",
      [userId]
    );
    const customer = customerRows[0];

    // Send to customer
    if (customer?.expo_push_token) {
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
      } catch (pushErr) {
        console.error(`⚠️ Failed to send push to customer ${userId}:`, pushErr.message);
      }
    }

    return { success: true, task: 'notifications' };
  } catch (error) {
    console.error(`❌ Error in sendNotificationsAsync:`, error);
    throw error;
  }
}

/**
 * Award wellness points to customer
 */
async function awardWellnessPointsAsync(userId, finalTotal, orderId) {
  try {
    // Award 1% of order amount as wellness points
    const pointsToAward = Math.floor(finalTotal * 0.01);
    
    if (pointsToAward > 0) {
      const conn = await pool.getConnection();
      try {
        await conn.execute(
          "UPDATE users SET store_credits = COALESCE(store_credits, 0) + ? WHERE id = ?",
          [pointsToAward, userId]
        );
        console.log(`✅ Awarded ${pointsToAward} wellness points to user ${userId} for order ${orderId}`);
      } finally {
        conn.release();
      }
    }

    return { success: true, task: 'wellness_points', pointsAwarded: pointsToAward };
  } catch (error) {
    console.error(`❌ Error in awardWellnessPointsAsync:`, error);
    throw error;
  }
}

/**
 * Log order analytics for reporting
 */
async function logOrderAnalyticsAsync(orderId, userId, shopkeeperId, finalTotal) {
  try {
    // Log order creation for analytics
    console.log(`📊 Order Analytics - Order: ${orderId}, User: ${userId}, Shop: ${shopkeeperId}, Amount: ₹${finalTotal}`);
    
    // Could be extended to write to analytics table or external service
    return { success: true, task: 'analytics' };
  } catch (error) {
    console.error(`❌ Error in logOrderAnalyticsAsync:`, error);
    throw error;
  }
}

// Apply order-specific middleware
router.use(refreshTokenIfNeeded);
router.use(handleOrderTokenExpiration);
router.use(handleCartTokenExpiration);

// ============================================================================
// CRITICAL FIX #7: GET DELIVERY SLOTS (Centralized calculation)
// ============================================================================
// GET /api/orders/delivery-slots?date=2026-03-29
router.get("/delivery-slots", verifyToken, async (req, res) => {
  try {
    const { date } = req.query;
    const baseDate = date ? new Date(date) : new Date();
    
    const slots = calculateDeliverySlots(baseDate);
    
    res.json({
      success: true,
      slots,
      config: {
        slotDurationMinutes: TIME_SLOT_CONFIG.INTERVAL_MINUTES,
        minAdvanceBookingMinutes: TIME_SLOT_CONFIG.MIN_ADVANCE_BOOKING_MINUTES,
        maxAdvanceBookingDays: TIME_SLOT_CONFIG.MAX_ADVANCE_BOOKING_DAYS,
        operatingHours: {
          start: `${TIME_SLOT_CONFIG.START_HOUR}:00`,
          end: `${TIME_SLOT_CONFIG.END_HOUR}:00`
        }
      }
    });
  } catch (error) {
    console.error('Error fetching delivery slots:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch delivery slots',
      error: error.message
    });
  }
});

// ============================================================================
// GET ALL ORDERS WITH FILTERS AND COUNTS
// ============================================================================
// GET /api/orders?status=all|pending|completed|cancelled&deliveryType=home_delivery|store_pickup
router.get("/", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { status = "all", deliveryType } = req.query;

    // Build WHERE clause for filtering based on role
    let whereConditions = [];
    let queryParams = [];

    if (userRole === "user") {
      whereConditions.push("o.user_id = ?");
      queryParams.push(userId);
    } else if (userRole === "shopkeeper") {
      whereConditions.push("o.shopkeeper_id = ?");
      queryParams.push(userId);
    } else if (userRole === "admin") {
      // Admin can see all orders unless filtered by another parameter
    } else {
      return res
        .status(403)
        .json({ success: false, message: "Unauthorized role" });
    }

    // Add status filter (map UI status to DB status)
    if (status && status !== "all") {
      if (status === "pending") {
        whereConditions.push("o.status IN ('Pending', 'Processing', 'Paid')");
      } else if (status === "completed") {
        whereConditions.push("o.status IN ('Completed', 'Delivered')");
      } else if (status === "cancelled") {
        whereConditions.push("o.status = 'Cancelled'");
      }
    }

    // Add delivery type filter (supports both store_pickup and click_and_collect)
    if (deliveryType) {
      if (deliveryType === "store_pickup" || deliveryType === "click_and_collect") {
        whereConditions.push("o.has_timer = 1");
      } else if (deliveryType === "home_delivery") {
        whereConditions.push("(o.has_timer = 0 OR o.has_timer IS NULL)");
      }
    }

    const whereClause =
      whereConditions.length > 0
        ? "WHERE " + whereConditions.join(" AND ")
        : "";

    // Get counts for all statuses
    let countWhereConditions = [];
    let countParams = [];

    if (userRole === "user") {
      countWhereConditions.push("o.user_id = ?");
      countParams.push(userId);
    } else if (userRole === "shopkeeper") {
      countWhereConditions.push("o.shopkeeper_id = ?");
      countParams.push(userId);
    }

    if (deliveryType) {
      if (deliveryType === "store_pickup" || deliveryType === "click_and_collect") {
        countWhereConditions.push("o.has_timer = 1");
      } else if (deliveryType === "home_delivery") {
        countWhereConditions.push("(o.has_timer = 0 OR o.has_timer IS NULL)");
      }
    }

    const countWhereClause =
      countWhereConditions.length > 0
        ? "WHERE " + countWhereConditions.join(" AND ")
        : "";

    const [counts] = await pool.execute(
      `
      SELECT 
        COUNT(*) as all_count,
        SUM(CASE WHEN o.status IN ('Pending', 'Processing', 'Paid') THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN o.status IN ('Completed', 'Delivered') THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN o.status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled_count
      FROM orders o
      ${countWhereClause}
    `,
      countParams
    );

    // Get filtered orders with shopkeeper and items details
    const [orders] = await pool.execute(
      `
      SELECT 
        o.id,
        o.id as orderId,
        o.id as order_id,
        o.user_id as userId,
        o.user_id as user_id,
        o.shopkeeper_id as shopkeeperId,
        o.shopkeeper_id as shopkeeper_id,
        CASE 
          WHEN o.has_timer = 1 THEN 'store_pickup'
          ELSE 'home_delivery'
        END as delivery_mode,
        CASE 
          WHEN o.status IN ('Completed', 'Delivered') THEN 'completed'
          WHEN o.status = 'Cancelled' THEN 'cancelled'
          ELSE 'pending'
        END as status,
        o.status as originalStatus,
        o.total_amount,
        o.credits_earned,
        o.credits_used,
        o.payment_method,
        o.delivery_address,
        o.latitude,
        o.longitude,
        o.has_timer,
        o.pickup_code,
        o.timer_started_at,
        o.timer_expires_at,
        o.created_at,
        o.scheduled_time,
        o.cancellation_reason,
        s.shop_name,
        s.name as shopkeeper_name,
        s.phone as shopkeeper_phone,
        s.address as shop_address
      FROM orders o
      LEFT JOIN shopkeepers s ON o.shopkeeper_id = s.id
      ${whereClause}
      ORDER BY o.created_at DESC
    `,
      queryParams
    );

    // Get order items for each order
    const orderIds = orders.map((o) => o.id);
    let orderItems = [];

    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => "?").join(",");
      const [items] = await pool.execute(
        `
        SELECT 
          oi.order_id as orderId,
          oi.product_id as productId,
          oi.quantity,
          oi.price,
          p.name as productName,
          p.image as productImage,
          p.category as productCategory
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id IN (${placeholders})
      `,
        orderIds
      );

      orderItems = items;
    }

    // Attach items and computed fields to each order
    const ordersWithItems = orders.map((order) => {
      // Compute delivery slot for home delivery orders (30-minute slots in next 12 hours)
      const computeDeliverySlot = (createdAt) => {
        const created = new Date(createdAt);
        const start = new Date(created);
        const minutes = start.getMinutes();
        const roundedMinutes =
          minutes % 30 === 0 ? minutes : minutes + (30 - (minutes % 30));
        start.setMinutes(roundedMinutes, 0, 0);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        const limit = new Date(created.getTime() + 12 * 60 * 60 * 1000);
        if (start > limit) {
          start.setTime(limit.getTime());
          end.setTime(limit.getTime() + 30 * 60 * 1000);
        }
        const label = `${start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - ${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
        return {
          startISO: start.toISOString(),
          endISO: end.toISOString(),
          label,
        };
      };

      return {
        ...order,
        items: orderItems
          .filter((item) => item.orderId === order.id)
          .map((item) => ({
            product_id: item.productId,
            product_name: item.productName,
            product_image: item.productImage,
            product_category: item.productCategory,
            quantity: item.quantity,
            price: parseFloat(item.price),
          })),
        delivery_slot:
          order.delivery_mode === "home_delivery"
            ? computeDeliverySlot(order.created_at)
            : null,
        timer_info:
          order.delivery_mode === "store_pickup"
            ? {
                has_timer: order.has_timer === 1,
                pickup_code: order.pickup_code,
                timer_started_at: order.timer_started_at,
                timer_expires_at: order.timer_expires_at,
                is_expired: order.timer_expires_at
                  ? new Date() > new Date(order.timer_expires_at)
                  : false,
              }
            : null,
      };
    });

    res.json({
      success: true,
      orders: ordersWithItems,
      counts: counts[0] || {
        all_count: 0,
        pending_count: 0,
        completed_count: 0,
        cancelled_count: 0,
      },
    });
  } catch (error) {
    console.error("Get orders error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message,
    });
  }
});

// ============================================================================
// CANCEL ORDER
// ============================================================================
// POST /api/orders/:orderId/cancel
router.post("/:orderId/cancel", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { orderId } = req.params;
    const { cancellation_reason = "Customer cancellation" } = req.body;

    const orderIdNum = parseInt(orderId);
    if (isNaN(orderIdNum)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid order ID" });
    }

    // Check if order exists and belongs to the user or shopkeeper
    const [orderRows] = await pool.execute(
      "SELECT id, user_id, shopkeeper_id, status FROM orders WHERE id = ?",
      [orderIdNum]
    );

    if (orderRows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    const order = orderRows[0];

    // Authorization check
    if (userRole === "user" && order.user_id !== userId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    } else if (userRole === "shopkeeper" && order.shopkeeper_id !== userId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // Only allow cancellation of certain statuses
    if (!["Pending", "Paid", "Processing"].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel order with status: ${order.status}`,
      });
    }

    // Start transaction for cancellation and stock restoration
    await pool.execute("START TRANSACTION");

    try {
      // Update order status
      await pool.execute(
        "UPDATE orders SET status = 'Cancelled', cancellation_reason = ? WHERE id = ?",
        [cancellation_reason, orderIdNum]
      );

      // Stop timer if order has one
      await pool.execute(
        `
        UPDATE order_timers 
        SET is_active = FALSE, stopped_at = NOW(), is_expired = FALSE
        WHERE order_id = ? AND is_active = TRUE
      `,
        [orderIdNum]
      );

      // Restore stock using manager utility
      const stockRestoration = await restoreStockForCancelledOrder(
        orderIdNum,
        userRole,
        cancellation_reason
      );

      await pool.execute("COMMIT");

      // Notify via socket
      if (req.io) {
        const shopRoom = `shop_${Number(order.shopkeeper_id)}`;
        const customerRoom = `customer_${Number(order.user_id)}`;

        const payload = {
          orderId: orderIdNum,
          status: "Cancelled",
          cancellation_reason,
          stockRestored: stockRestoration.success,
        };

        req.io.to(shopRoom).emit("orderStatusUpdate", payload);
        req.io.to(customerRoom).emit("orderStatusUpdate", payload);
      }

      // Send push notification to the other party (not the canceller)
      try {
        const targetId = userRole === "user" ? order.shopkeeper_id : order.user_id;
        const targetTable = userRole === "user" ? "shopkeepers" : "users";
        const [[target]] = await pool.execute(
          `SELECT expo_push_token FROM ${targetTable} WHERE id = ?`,
          [targetId]
        );

        if (target?.expo_push_token) {
          const cancelledBy = userRole === "user" ? "customer" : "shopkeeper";
          const title = `Order #${orderIdNum} Cancelled`;
          const body = `Order was cancelled by ${cancelledBy}${cancellation_reason ? `: ${cancellation_reason}` : ''}`;
          const pushPayload = { 
            orderId: String(orderIdNum), 
            status: "Cancelled",
            cancellation_reason,
            cancelled_by: cancelledBy
          };

          try {
            if (isFCMToken(target.expo_push_token)) {
              await sendFCMPush(target.expo_push_token, title, body, pushPayload);
            } else {
              await sendExpoPush(target.expo_push_token, title, body, pushPayload);
            }
          } catch (pushErr) {
            console.error(`Failed to send cancellation push to ${targetTable}:`, pushErr);
          }
        }
      } catch (pushErr) {
        console.error("Error sending cancellation push:", pushErr);
      }

      res.json({
        success: true,
        message: "Order cancelled and stock restored successfully",
        orderId: orderIdNum,
        stockRestoration,
      });
    } catch (transactionError) {
      await pool.execute("ROLLBACK");
      throw transactionError;
    }
  } catch (error) {
    console.error("Cancel order error:", error);
    res.status(500).json({ success: false, message: "Failed to cancel order" });
  }
});

// ============================================================================
// CLEAR ALL USER ORDERS
// ============================================================================
// DELETE /api/orders/clear-all
router.delete("/clear-all", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole !== "user") {
      return res.status(403).json({
        success: false,
        message: "Only customers can clear their order history",
      });
    }

    // First, delete order items
    await pool.execute(
      `DELETE oi FROM order_items oi
       INNER JOIN orders o ON oi.order_id = o.id
       WHERE o.user_id = ?`,
      [userId]
    );

    // Then delete orders
    const [result] = await pool.execute("DELETE FROM orders WHERE user_id = ?", [
      userId,
    ]);

    res.json({
      success: true,
      message: "Order history cleared successfully",
      clearedCount: result.affectedRows,
    });
  } catch (error) {
    console.error("Clear orders error:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error while clearing orders" });
  }
});

// ============================================================================
// GET ORDERS BY STATUS
// ============================================================================
// GET /api/orders/status/:status
router.get("/status/:status", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.params;

    // Validate status
    const validStatuses = ["pending", "completed", "cancelled", "all"];
    if (!validStatuses.includes(status.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid status. Must be one of: pending, completed, cancelled, all",
      });
    }

    // Build status condition
    let statusCondition = "";
    if (status === "pending") {
      statusCondition = "AND o.status = 'Pending'";
    } else if (status === "completed") {
      statusCondition = "AND o.status = 'Completed'";
    } else if (status === "cancelled") {
      statusCondition = "AND o.status = 'Cancelled'";
    }

    const [orders] = await pool.execute(
      `
      SELECT 
        o.id,
        o.id as order_id,
        o.user_id,
        CASE 
          WHEN o.has_timer = 1 THEN 'store_pickup'
          ELSE 'home_delivery'
        END as delivery_mode,
        CASE 
          WHEN o.status = 'Completed' THEN 'completed'
          WHEN o.status = 'Cancelled' THEN 'cancelled'
          ELSE 'pending'
        END as status,
        o.status as original_status,
        o.total_amount,
        o.created_at,
        s.shop_name,
        s.name as shopkeeper_name
      FROM orders o
      LEFT JOIN shopkeepers s ON o.shopkeeper_id = s.id
      WHERE o.user_id = ? ${statusCondition}
      ORDER BY o.created_at DESC
    `,
      [userId]
    );

    // Get items for orders
    const orderIds = orders.map((o) => o.id);
    let orderItems = [];

    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => "?").join(",");
      const [items] = await pool.execute(
        `
        SELECT 
          oi.order_id,
          oi.product_id,
          oi.quantity,
          oi.price,
          p.name as product_name
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id IN (${placeholders})
      `,
        orderIds
      );

      orderItems = items;
    }

    const ordersWithItems = orders.map((order) => ({
      ...order,
      items: orderItems.filter((item) => item.order_id === order.id),
    }));

    res.json({
      success: true,
      orders: ordersWithItems,
    });
  } catch (error) {
    console.error("Get orders by status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message,
    });
  }
});

// ============================================================================
// GET SINGLE ORDER DETAILS
// ============================================================================
// GET /api/orders/:orderId
router.get("/:orderId", verifyToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const [orders] = await pool.execute(
      `
      SELECT 
        o.id,
        o.id as order_id,
        o.user_id,
        o.shopkeeper_id,
        CASE 
          WHEN o.has_timer = 1 THEN 'store_pickup'
          ELSE 'home_delivery'
        END as delivery_mode,
        CASE 
          WHEN o.status = 'Completed' THEN 'completed'
          WHEN o.status = 'Cancelled' THEN 'cancelled'
          WHEN o.status = 'Paid' THEN 'paid'
          ELSE 'pending'
        END as status,
        o.status as original_status,
        o.total_amount,
        o.payment_status,
        o.payment_method,
        o.delivery_address,
        o.pickup_code,
        o.created_at,
        o.scheduled_time,
        o.cancellation_reason,
        s.shop_name,
        s.name as shopkeeper_name,
        s.upi_id as shop_upi
      FROM orders o
      LEFT JOIN shopkeepers s ON o.shopkeeper_id = s.id
      WHERE o.id = ? AND (o.user_id = ? OR o.shopkeeper_id = ? OR ? IN (SELECT id FROM admins))
    `,
      [orderId, userId, userId, userId]
    );

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const order = orders[0];

    // Get items for this order
    const [items] = await pool.execute(
      `
      SELECT 
        oi.product_id,
        oi.quantity,
        oi.price,
        p.name as product_name
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `,
      [orderId]
    );

    res.json({
      success: true,
      order: {
        ...order,
        items,
      },
    });
  } catch (error) {
    console.error("Get order details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch order details",
      error: error.message,
    });
  }
});

// GET /api/orders/:orderId/timer
router.get("/:orderId/timer", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId } = req.params;

    const [timerInfo] = await pool.execute(
      `
      SELECT o.id, o.status, o.has_timer, o.pickup_code, o.timer_started_at, o.timer_expires_at,
             ot.timer_duration, ot.is_active, ot.is_expired, ot.stopped_at,
             s.shop_name, s.name as shopkeeperName, s.phone as shopkeeperPhone, 
             s.address as shopAddress, s.latitude as shopLatitude, s.longitude as shopLongitude
      FROM orders o
      LEFT JOIN order_timers ot ON o.id = ot.order_id
      LEFT JOIN shopkeepers s ON o.shopkeeper_id = s.id
      WHERE o.id = ? AND o.user_id = ?
    `,
      [orderId, userId]
    );

    if (timerInfo.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    const timer = timerInfo[0];
    let timeLeft = 0;

    if (timer.is_active && timer.timer_expires_at) {
      const now = new Date();
      const expiresAt = new Date(timer.timer_expires_at);
      timeLeft = Math.max(0, Math.floor((expiresAt - now) / 1000));
    }

    res.json({
      success: true,
      timer: {
        order_id: timer.id,
        orderId: timer.id,
        status: timer.status,
        has_timer: timer.has_timer,
        pickup_code: timer.pickup_code,
        is_active: timer.is_active,
        is_expired: timer.is_expired,
        time_left: timeLeft,
        timer_duration: timer.timer_duration,
        started_at: timer.timer_started_at,
        expires_at: timer.timer_expires_at,
        stopped_at: timer.stopped_at,
        shop_info: {
          shopName: timer.shop_name,
          shopkeeperName: timer.shopkeeperName,
          shopkeeperPhone: timer.shopkeeperPhone,
          shopAddress: timer.shopAddress,
          shopLatitude: timer.shopLatitude,
          shopLongitude: timer.shopLongitude,
        },
      },
    });
  } catch (err) {
    console.error("Get order timer error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /api/orders/:orderId/status
router.get("/:orderId/status", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId } = req.params;

    const [orderInfo] = await pool.execute(
      `
      SELECT id, id as orderId, status, has_timer, pickup_code, timer_started_at, timer_expires_at,
             total_amount as totalAmount, created_at as createdAt, credits_earned as creditsEarned
      FROM orders 
      WHERE id = ? AND user_id = ?
    `,
      [orderId, userId]
    );

    if (orderInfo.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    res.json({ success: true, order: orderInfo[0] });
  } catch (err) {
    console.error("Get order status error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ============================================================================
// CREATE NEW ORDER - OPTIMIZED WITH PREFETCH CACHE
// ============================================================================
// POST /api/orders
router.post("/", verifyToken, async (req, res) => {
  const startTime = Date.now();
  const connection = await pool.getConnection();

  try {
    const userId = req.user.id;
    const shopkeeperId = req.body.shopkeeperId || req.body.shopId;

    // OPTIMIZATION #1: Use cached shopkeeper data (saves ~50-100ms)
    let shopkeeper = getCachedShopkeeper(shopkeeperId);
    
    if (!shopkeeper) {
      // Fallback to DB if not cached
      const [shopkeeperCheck] = await connection.execute(
        `SELECT id, subscription_status, is_deleted, expo_push_token FROM shopkeepers WHERE id = ? LIMIT 1`,
        [shopkeeperId]
      );
      
      if (!shopkeeperCheck || shopkeeperCheck.length === 0) {
        connection.release();
        return res.status(404).json({
          success: false,
          message: 'Shopkeeper not found',
          code: 'SHOP_NOT_FOUND'
        });
      }
      shopkeeper = shopkeeperCheck[0];
    }
    
    // Validate shopkeeper status
    if (shopkeeper.is_deleted) {
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'This shop is no longer available',
        code: 'SHOP_DELETED'
      });
    }
    
    if (shopkeeper.subscription_status !== 'active') {
      connection.release();
      return res.status(400).json({
        success: false,
        message: `Shop is currently ${shopkeeper.subscription_status}. Cannot place orders.`,
        code: 'SHOP_INACTIVE',
        shopStatus: shopkeeper.subscription_status
      });
    }

    await connection.beginTransaction();
    // Extract with aliases for compatibility with frontend naming conventions
    const {
      items: reqItems,
      products,
      deliveryType: reqDeliveryType,
      order_type,
      totalAmount: reqTotalAmount,
      total,
      grandTotal,
      shopkeeperId: reqShopkeeperId,
      shopId,
      paymentMethod = "cod",
      deliveryAddress: reqDeliveryAddress,
      address,
      latitude = null,
      longitude = null,
      creditsUsed: reqCreditsUsed,
      pointsToRedeem,
      scheduled_time: reqScheduledTime,
    } = req.body;

    // Use aliases if main fields are missing
    const items = reqItems || products;
    const deliveryType = req.body.deliveryType || order_type || "home_delivery";
    const totalAmount = reqTotalAmount || grandTotal || total;
    // shopkeeperId already declared earlier, just reassign if needed
    // const shopkeeperId = reqShopkeeperId || shopId;
    const deliveryAddress = reqDeliveryAddress || address || null;
    const creditsUsed = reqCreditsUsed || pointsToRedeem || 0;
    const scheduledTime = reqScheduledTime || req.body.scheduledTime || null;

    // Validate required fields
    if (!items || !Array.isArray(items) || items.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Items array is required and cannot be empty",
      });
    }

    if (!totalAmount || totalAmount <= 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Valid total amount is required",
      });
    }

    if (!shopkeeperId) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Shopkeeper ID is required",
      });
    }

    // CRITICAL FIX #3: Validate stock availability with row-level locking
    // Lock rows for update to prevent concurrent modifications
    const productIds = items.map(item => item.productId || item.product_id);
    const placeholders = productIds.map(() => '?').join(',');
    
    const [products_check] = await connection.execute(
      `SELECT id, stock FROM products WHERE id IN (${placeholders}) AND shop_id = ? FOR UPDATE`,
      [...productIds, shopkeeperId]
    );
    
    // Validate stock for each item
    for (const item of items) {
      const productId = item.productId || item.product_id;
      const product = products_check.find(p => p.id === productId);
      
      if (!product) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: `Product ${productId} not found`,
          code: 'PRODUCT_NOT_FOUND',
          productId
        });
      }
      
      if (product.stock < item.quantity) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for product ${productId}`,
          code: 'INSUFFICIENT_STOCK',
          productId,
          requestedQuantity: item.quantity,
          availableStock: product.stock
        });
      }
    }

    // Determine if this is a store pickup order (supports both store_pickup and click_and_collect)
    const hasTimer = (deliveryType === "store_pickup" || deliveryType === "click_and_collect") ? 1 : 0;
    // Generate pickup/verification code for ALL orders (both pickup and delivery)
    const pickupCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    console.log(`📋 Order creation: deliveryType="${deliveryType}", hasTimer=${hasTimer}, pickupCode="${pickupCode}" (type=${typeof pickupCode})`);

    // OPTIMIZATION #2: Use cached user data for points (saves ~30-50ms)
    let pointsDiscount = 0;
    if (creditsUsed > 0) {
      try {
        let user = getCachedUser(userId);
        
        if (!user) {
          // Fallback to DB if not cached
          const [[userDb]] = await connection.execute(
            "SELECT store_credits, expo_push_token FROM users WHERE id = ?",
            [userId]
          );
          if (!userDb) {
            await connection.rollback();
            return res
              .status(404)
              .json({ success: false, message: "User not found" });
          }
          user = userDb;
        }

        const validation = validatePointsUsage(
          creditsUsed,
          user.store_credits || 0,
          totalAmount
        );
        if (!validation.valid) {
          await connection.rollback();
          return res
            .status(400)
            .json({ success: false, message: validation.message });
        }

        const pointsResult = await deductWellnessPoints(
          connection,
          userId,
          creditsUsed
        );
        pointsDiscount = pointsResult.discountAmount;
        
        // Invalidate user cache after points change
        invalidateUserCache(userId);
      } catch (pointsError) {
        await connection.rollback();
        return res
          .status(400)
          .json({ success: false, message: pointsError.message });
      }
    }

    const finalTotal = totalAmount - pointsDiscount;

    // Get next order ID (TiDB doesn't support auto-increment reliably)
    const [maxOrderId] = await connection.execute(
      "SELECT COALESCE(MAX(id), 0) + 1 as nextId FROM orders"
    );
    const orderId = maxOrderId[0].nextId;
    
    // Calculate credits earned (1% of total amount)
    const creditsEarned = Math.floor(finalTotal * 0.01);

    // Precompute timer timestamps for click & collect
    const now = new Date();
    // Convert to ISO string format for proper MySQL/TiDB handling
    const timerStartedAt = hasTimer ? now.toISOString().slice(0, 19).replace('T', ' ') : null;
    const timerExpiresAt = hasTimer
      ? new Date(now.getTime() + TIMER_DURATION_SECONDS * 1000).toISOString().slice(0, 19).replace('T', ' ')
      : null;

    // Insert order
    await connection.execute(
      `
      INSERT INTO orders (
        id,
        user_id, 
        shopkeeper_id, 
        status, 
        payment_method,
        total_amount, 
        credits_earned,
        credits_used,
        delivery_address,
        latitude,
        longitude,
        has_timer,
        pickup_code,
        timer_started_at,
        timer_expires_at,
        order_type,
        delivery_mode,
        scheduled_time,
        created_at
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
        deliveryType === "store_pickup" || deliveryType === "click_and_collect" || deliveryType === "pickup"
          ? "pickup"
          : "delivery",
        deliveryType === "store_pickup" || deliveryType === "click_and_collect" || deliveryType === "pickup"
          ? "pickup"
          : "delivery",
        scheduledTime,
      ]
    );

    // Create timer record in order_timers table (only for pickup orders)
    if (hasTimer) {
      try {
        await connection.execute(
          `
          INSERT INTO order_timers (order_id, pickup_code, timer_duration, timer_started_at, timer_expires_at, is_active)
          VALUES (?, ?, ?, ?, ?, TRUE)
        `,
          [
            orderId,
            pickupCode,
            TIMER_DURATION_SECONDS,
            timerStartedAt,
            timerExpiresAt,
          ]
        );
      } catch (timerError) {
        console.warn("Timer record creation failed:", timerError.message);
      }
    }

    // OPTIMIZATION: Batch insert order items (saves ~200-400ms per item)
    if (items.length > 0) {
      // Get starting item ID
      const [maxItemId] = await connection.execute(
        "SELECT COALESCE(MAX(id), 0) + 1 as nextId FROM order_items"
      );
      let itemId = maxItemId[0].nextId;

      // Build batch insert query
      const itemValues = [];
      const itemParams = [];
      const stockUpdates = [];

      for (const item of items) {
        const productId = item.productId || item.product_id;
        const quantity = item.quantity || item.qty || 1;
        const price = item.price || 0;

        if (!productId) {
          console.warn("Skipping item with missing productId", item);
          continue;
        }

        // Add to batch insert
        itemValues.push('(?, ?, ?, ?, ?)');
        itemParams.push(itemId, orderId, productId, quantity, price);
        
        // Prepare stock update
        stockUpdates.push({ productId, quantity });
        
        itemId++;
      }

      // Single batch insert for all items (instead of N queries)
      if (itemValues.length > 0) {
        await connection.execute(
          `INSERT INTO order_items (id, order_id, product_id, quantity, price) 
           VALUES ${itemValues.join(', ')}`,
          itemParams
        );

        // REMOVED: Manual stock update (now handled by inventory hook)
        // Stock deduction is handled by onOrderCreated hook in background
      }
    }

    // Deduct inventory stock for order items (moved to background)
    // Stock deduction will happen via inventory hook after response is sent

    await connection.commit();
    
    // Invalidate product cache after stock change
    invalidateProductCache(shopkeeperId);

    // OPTIMIZATION #3: Calculate response time and send immediate response
    const responseTime = Date.now() - startTime;
    console.log(`⚡ Order ${orderId} created in ${responseTime}ms`);

    // Send immediate response to client
    res.json({
      success: true,
      message: "Order placed successfully",
      order: {
        id: orderId,
        orderId,
        totalAmount: finalTotal,
        pickupCode,
        pickup_code: pickupCode, // Add snake_case for compatibility
        creditsEarned,
        processingTime: responseTime,
      },
    });

    // OPTIMIZATION #4: Execute ALL non-critical operations in background
    // This includes: notifications, socket broadcasts, inventory hook
    setImmediate(async () => {
      try {
        // Execute inventory hook in background
        await onOrderCreated(orderId).catch(err => {
          console.error(`❌ Inventory hook error for order ${orderId}:`, err);
        });

        // Use cached shopkeeper data or fetch if needed
        let shopkeeperData = getCachedShopkeeper(shopkeeperId);
        let userData = getCachedUser(userId);

        // Parallel fetch if not cached
        if (!shopkeeperData || !userData) {
          const fetchPromises = [];
          
          if (!shopkeeperData) {
            fetchPromises.push(
              connection.execute(
                "SELECT shop_name, name, phone, address, latitude, longitude, expo_push_token FROM shopkeepers WHERE id = ?",
                [shopkeeperId]
              ).then(([rows]) => rows[0])
            );
          } else {
            fetchPromises.push(Promise.resolve(shopkeeperData));
          }

          if (!userData) {
            fetchPromises.push(
              connection.execute(
                "SELECT expo_push_token FROM users WHERE id = ?",
                [userId]
              ).then(([rows]) => rows[0])
            );
          } else {
            fetchPromises.push(Promise.resolve(userData));
          }

          const [shopData, userDataFetched] = await Promise.all(fetchPromises);
          shopkeeperData = shopData;
          userData = userDataFetched;
        }

        // Send notifications in parallel (non-blocking)
        const notificationPromises = [];

        // Shopkeeper notification
        if (shopkeeperData?.expo_push_token) {
          const token = shopkeeperData.expo_push_token;
          const title = "📦 New Order Received!";
          const body = `You have a new order (#${orderId}) worth ₹${finalTotal.toFixed(2)}.`;
          const payload = { orderId: String(orderId), shopId: String(shopkeeperId) };

          notificationPromises.push(
            (isFCMToken(token) 
              ? sendFCMPush(token, title, body, payload) 
              : sendExpoPush(token, title, body, payload)
            ).catch(err => console.error(`Failed to send push to shopkeeper:`, err))
          );
        }

        // Customer notification
        if (userData?.expo_push_token) {
          const token = userData.expo_push_token;
          const title = "Order Placed Successfully!";
          const body = `Your order #${orderId} has been placed. You can track it in the app.`;
          const payload = { orderId: String(orderId), status: "Pending" };

          notificationPromises.push(
            (isFCMToken(token) 
              ? sendFCMPush(token, title, body, payload) 
              : sendExpoPush(token, title, body, payload)
            ).catch(err => console.error(`Failed to send push to customer:`, err))
          );
        }

        // Execute all notifications in parallel
        await Promise.allSettled(notificationPromises);

        // Socket broadcast (minimal payload) - EMIT ONCE PER ROOM
        if (req.io) {
          const shopRoom = `shop_${Number(shopkeeperId)}`;
          const customerRoom = `customer_${Number(userId)}`;

          const socketPayload = {
            id: orderId,
            orderId,
            userId,
            shopkeeperId,
            status: "pending",
            totalAmount: finalTotal,
            creditsEarned,
            pickupCode,
            hasTimer: hasTimer === 1,
            timerStartedAt,
            timerExpiresAt,
            createdAt: now.toISOString(),
          };

          // Emit ONLY 'orderCreated' event to avoid duplicate listeners
          req.io.to(shopRoom).emit("orderCreated", socketPayload);
          req.io.to(customerRoom).emit("orderCreated", socketPayload);
          req.io.to("admin").emit("orderCreated", socketPayload);
        }

        // Execute background tasks (wellness points, analytics)
        await executeBackgroundTasksAsync(orderId, userId, shopkeeperId, finalTotal, connection);

        console.log(`✅ Background tasks completed for order ${orderId}`);
      } catch (bgError) {
        console.error(`❌ Background task error for order ${orderId}:`, bgError);
        // Don't throw - order is already created
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error("Create order error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create order",
      error: error.message,
    });
  } finally {
    connection.release();
  }
});

// ============================================================================
// UPDATE ORDER STATUS
// ============================================================================
// PATCH /api/orders/:orderId/status
router.patch("/:orderId/status", verifyToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, cancellation_reason } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    const orderIdNum = parseInt(orderId);
    if (isNaN(orderIdNum)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid order ID" });
    }

    // Validate status
    const validStatuses = [
      "pending",
      "completed",
      "cancelled",
      "paid",
      "processing",
    ];
    if (!validStatuses.includes(status.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be one of: " + validStatuses.join(", "),
      });
    }

    // Map frontend status to database status
    const statusMap = {
      pending: "Pending",
      completed: "Completed",
      cancelled: "Cancelled",
      paid: "Paid",
      processing: "Processing",
    };
    const dbStatus = statusMap[status.toLowerCase()];

    // Check if order exists and get details for authorization and notifications
    const [orderRows] = await pool.execute(
      `
      SELECT id, status, user_id, shopkeeper_id, total_amount, has_timer, timer_started_at, order_type, delivery_mode
      FROM orders 
      WHERE id = ?
    `,
      [orderIdNum]
    );

    if (orderRows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    const order = orderRows[0];

    // Authorization check
    if (userRole === "user" && order.user_id !== userId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    } else if (userRole === "shopkeeper" && order.shopkeeper_id !== userId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    } else if (
      userRole !== "user" &&
      userRole !== "shopkeeper" &&
      userRole !== "admin"
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // Business Logic: Handle specific status transitions
    if (dbStatus === "Cancelled") {
      console.log(`📦 Order ${orderIdNum} being cancelled by ${userRole}`);

      await pool.execute("START TRANSACTION");
      try {
        await pool.execute(
          "UPDATE orders SET status = 'Cancelled', cancellation_reason = ? WHERE id = ?",
          [cancellation_reason || `${userRole} cancellation`, orderIdNum]
        );

        // Stop timer
        await pool.execute(
          `
          UPDATE order_timers 
          SET is_active = FALSE, stopped_at = NOW(), is_expired = FALSE
          WHERE order_id = ? AND is_active = TRUE
        `,
          [orderIdNum]
        );

        // Restore stock
        await restoreStockForCancelledOrder(
          orderIdNum,
          userRole,
          cancellation_reason
        );

        // Refund credits if any
        const [[creditsData]] = await pool.execute(
          "SELECT credits_used FROM orders WHERE id = ?",
          [orderIdNum]
        );
        if (creditsData?.credits_used > 0) {
          await pool.execute(
            "UPDATE users SET store_credits = COALESCE(store_credits, 0) + ? WHERE id = ?",
            [creditsData.credits_used, order.user_id]
          );
        }

        await pool.execute("COMMIT");
      } catch (err) {
        await pool.execute("ROLLBACK");
        throw err;
      }
    } else if (dbStatus === "Completed") {
      await pool.execute("UPDATE orders SET status = 'Completed' WHERE id = ?", [
        orderIdNum,
      ]);

      // Award wellness points
      try {
        const orderType = order.order_type || order.delivery_mode || "pickup";
        await awardWellnessPoints(
          pool,
          order.user_id,
          new Date(),
          order.timer_started_at || new Date(),
          order.total_amount,
          orderType
        );
      } catch (pointsErr) {
        console.error("Error awarding points:", pointsErr);
      }
    } else {
      await pool.execute("UPDATE orders SET status = ? WHERE id = ?", [
        dbStatus,
        orderIdNum,
      ]);
    }

    // Socket Notification
    if (req.io) {
      const payload = {
        orderId: orderIdNum,
        order_id: orderIdNum,
        status: dbStatus,
        updatedAt: new Date().toISOString(),
      };
      req.io
        .to(`shop_${order.shopkeeper_id}`)
        .emit("orderStatusUpdate", payload);
      req.io.to(`customer_${order.user_id}`).emit("orderStatusUpdate", payload);
      req.io.to("admin").emit("orderStatusUpdate", payload);
    }

    // Push Notification
    try {
      const targetId =
        userRole === "user" ? order.shopkeeper_id : order.user_id;
      const targetTable = userRole === "user" ? "shopkeepers" : "users";
      const [[target]] = await pool.execute(
        `SELECT expo_push_token FROM ${targetTable} WHERE id = ?`,
        [targetId]
      );

      if (target?.expo_push_token) {
        const title = `Order #${orderIdNum} Update`;
        const body = `Your order status has been updated to ${dbStatus}.`;
        const payload = { orderId: String(orderIdNum), status: dbStatus };

        try {
          if (isFCMToken(target.expo_push_token)) {
            await sendFCMPush(target.expo_push_token, title, body, payload);
          } else {
            await sendExpoPush(target.expo_push_token, title, body, payload);
          }
        } catch (pushErr) {
          console.error(
            `Failed to send status update push to ${targetTable}:`,
            pushErr
          );
        }
      }
    } catch (pushErr) {
      console.error("Error sending push:", pushErr);
    }

    res.json({
      success: true,
      message: `Order status updated to ${dbStatus}`,
      status: dbStatus,
    });
  } catch (error) {
    console.error("Update order status error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to update status" });
  }
});

// ============================================================================
// LEGACY ROUTES (Keep for backward compatibility)
// ============================================================================

// Cart routes with specific error handling
router.get("/cart", handleCartTokenExpiration, verifyToken, (req, res) => {
  res.json({
    success: true,
    message: "Cart retrieved successfully",
    cart: [],
    user: req.user,
  });
});

router.post("/cart/add", handleCartTokenExpiration, verifyToken, (req, res) => {
  res.json({
    success: true,
    message: "Item added to cart",
    user: req.user,
  });
});

// Apply order error handler
router.use(orderErrorHandler);

export default router;