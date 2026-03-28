import express from "express";
import verifyToken from "../middleware/auth.js";
import { handleOrderTokenExpiration, handleCartTokenExpiration, orderErrorHandler } from "../middleware/orderErrorHandler.js";
import { refreshTokenIfNeeded } from "../middleware/tokenRefresh.js";
import pool from "../config/db.js";
import { 
  validateStockAvailability,
  onOrderCreated,
  onOrderCancelled
} from '../middleware/inventory.order.hooks.js';
import { TIMER_DURATION_SECONDS, TIME_SLOT_CONFIG, ORDER_STATUS } from '../config/constants.js';
import { validatePointsUsage, deductWellnessPoints, awardWellnessPoints } from '../utils/wellnessPoints.js';
import { sendExpoPush } from '../utils/expoPush.js';
import { sendFCMPush, isFCMToken } from '../utils/fcmPush.js';
import { restoreStockForCancelledOrder } from "../utils/stockManager.js";

const router = express.Router();

// Apply order-specific middleware
router.use(refreshTokenIfNeeded);
router.use(handleOrderTokenExpiration);
router.use(handleCartTokenExpiration);

// ============================================================================
// GET ALL ORDERS WITH FILTERS AND COUNTS
// ============================================================================
// GET /api/orders?status=all|pending|completed|cancelled&deliveryType=home_delivery|store_pickup
router.get("/", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { status = 'all', deliveryType } = req.query;

    // Build WHERE clause for filtering based on role
    let whereConditions = [];
    let queryParams = [];

    if (userRole === 'user') {
      whereConditions.push('o.user_id = ?');
      queryParams.push(userId);
    } else if (userRole === 'shopkeeper') {
      whereConditions.push('o.shopkeeper_id = ?');
      queryParams.push(userId);
    } else if (userRole === 'admin') {
      // Admin can see all orders unless filtered by another parameter
    } else {
      return res.status(403).json({ success: false, message: "Unauthorized role" });
    }

    // Add status filter (map UI status to DB status)
    if (status && status !== 'all') {
      if (status === 'pending') {
        whereConditions.push("o.status IN ('Pending', 'Processing', 'Paid')");
      } else if (status === 'completed') {
        whereConditions.push("o.status IN ('Completed', 'Delivered')");
      } else if (status === 'cancelled') {
        whereConditions.push("o.status = 'Cancelled'");
      }
    }

    // Add delivery type filter
    if (deliveryType) {
      if (deliveryType === 'store_pickup') {
        whereConditions.push('o.has_timer = 1');
      } else if (deliveryType === 'home_delivery') {
        whereConditions.push('(o.has_timer = 0 OR o.has_timer IS NULL)');
      }
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    // Get counts for all statuses
    let countWhereConditions = [];
    let countParams = [];
    
    if (userRole === 'user') {
      countWhereConditions.push('o.user_id = ?');
      countParams.push(userId);
    } else if (userRole === 'shopkeeper') {
      countWhereConditions.push('o.shopkeeper_id = ?');
      countParams.push(userId);
    }

    if (deliveryType) {
      if (deliveryType === 'store_pickup') {
        countWhereConditions.push('o.has_timer = 1');
      } else if (deliveryType === 'home_delivery') {
        countWhereConditions.push('(o.has_timer = 0 OR o.has_timer IS NULL)');
      }
    }
    
    const countWhereClause = countWhereConditions.length > 0 ? 'WHERE ' + countWhereConditions.join(' AND ') : '';

    const [counts] = await pool.execute(`
      SELECT 
        COUNT(*) as all_count,
        SUM(CASE WHEN o.status IN ('Pending', 'Processing', 'Paid') THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN o.status IN ('Completed', 'Delivered') THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN o.status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled_count
      FROM orders o
      ${countWhereClause}
    `, countParams);

    // Get filtered orders with shopkeeper and items details
    const [orders] = await pool.execute(`
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
        END as deliveryType,
        CASE 
          WHEN o.status IN ('Completed', 'Delivered') THEN 'completed'
          WHEN o.status = 'Cancelled' THEN 'cancelled'
          ELSE 'pending'
        END as status,
        o.status as originalStatus,
        o.total_amount as totalAmount,
        o.total_amount as total_amount,
        o.credits_earned as creditsEarned,
        o.credits_used as creditsUsed,
        o.payment_method as paymentMethod,
        o.delivery_address as deliveryAddress,
        o.latitude,
        o.longitude,
        o.has_timer as hasTimer,
        o.pickup_code as pickupCode,
        o.timer_started_at as timerStartedAt,
        o.timer_expires_at as timerExpiresAt,
        o.created_at as createdAt,
        s.shop_name as shopName,
        s.name as shopkeeperName,
        s.phone as shopkeeperPhone,
        s.address as shopAddress
      FROM orders o
      LEFT JOIN shopkeepers s ON o.shopkeeper_id = s.id
      ${whereClause}
      ORDER BY o.created_at DESC
    `, queryParams);

    // Get order items for each order
    const orderIds = orders.map(o => o.id);
    let orderItems = [];
    
    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => '?').join(',');
      const [items] = await pool.execute(`
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
      `, orderIds);
      
      orderItems = items;
    }

    // Attach items and computed fields to each order
    const ordersWithItems = orders.map(order => {
      // Compute delivery slot for home delivery orders (30-minute slots in next 12 hours)
      const computeDeliverySlot = (createdAt) => {
        const created = new Date(createdAt);
        const start = new Date(created);
        const minutes = start.getMinutes();
        const roundedMinutes = minutes % 30 === 0 ? minutes : minutes + (30 - (minutes % 30));
        start.setMinutes(roundedMinutes, 0, 0);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        const limit = new Date(created.getTime() + 12 * 60 * 60 * 1000);
        if (start > limit) {
          start.setTime(limit.getTime());
          end.setTime(limit.getTime() + 30 * 60 * 1000);
        }
        const label = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        return { startISO: start.toISOString(), endISO: end.toISOString(), label };
      };

      return {
        ...order,
        items: orderItems.filter(item => item.orderId === order.id).map(item => ({
          productId: item.productId,
          productName: item.productName,
          productImage: item.productImage,
          productCategory: item.productCategory,
          quantity: item.quantity,
          price: parseFloat(item.price)
        })),
        deliverySlot: order.deliveryType === 'home_delivery' ? computeDeliverySlot(order.createdAt) : null,
        timerInfo: order.deliveryType === 'store_pickup' ? {
          hasTimer: order.hasTimer === 1,
          pickupCode: order.pickupCode,
          timerStartedAt: order.timerStartedAt,
          timerExpiresAt: order.timerExpiresAt,
          isExpired: order.timerExpiresAt ? new Date() > new Date(order.timerExpiresAt) : false
        } : null
      };
    });

    res.json({
      success: true,
      orders: ordersWithItems,
      counts: counts[0] || { all_count: 0, pending_count: 0, completed_count: 0, cancelled_count: 0 }
    });

  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message
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
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    // Check if order exists and belongs to the user or shopkeeper
    const [orderRows] = await pool.query(
      "SELECT id, user_id, shopkeeper_id, status FROM orders WHERE id = ?",
      [orderIdNum]
    );

    if (orderRows.length === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const order = orderRows[0];

    // Authorization check
    if (userRole === 'user' && order.user_id !== userId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    } else if (userRole === 'shopkeeper' && order.shopkeeper_id !== userId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // Only allow cancellation of certain statuses
    if (!['Pending', 'Paid', 'Processing'].includes(order.status)) {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot cancel order with status: ${order.status}` 
      });
    }

    // Start transaction for cancellation and stock restoration
    await pool.query("START TRANSACTION");

    try {
      // Update order status
      await pool.query(
        "UPDATE orders SET status = 'Cancelled', cancellation_reason = ? WHERE id = ?",
        [cancellation_reason, orderIdNum]
      );

      // Stop timer if order has one
      await pool.query(`
        UPDATE order_timers 
        SET is_active = FALSE, stopped_at = NOW(), is_expired = FALSE
        WHERE order_id = ? AND is_active = TRUE
      `, [orderIdNum]);

      // Restore stock using manager utility
      const stockRestoration = await restoreStockForCancelledOrder(
        orderIdNum, 
        userRole, 
        cancellation_reason
      );

      await pool.query("COMMIT");

      // Notify via socket
      if (req.io) {
        const shopRoom = `shop_${Number(order.shopkeeper_id)}`;
        const customerRoom = `customer_${Number(order.user_id)}`;
        
        const payload = {
          orderId: orderIdNum,
          status: 'Cancelled',
          cancellation_reason,
          stockRestored: stockRestoration.success
        };

        req.io.to(shopRoom).emit("orderStatusUpdate", payload);
        req.io.to(customerRoom).emit("orderStatusUpdate", payload);
      }

      res.json({
        success: true,
        message: "Order cancelled and stock restored successfully",
        orderId: orderIdNum,
        stockRestoration
      });

    } catch (transactionError) {
      await pool.query("ROLLBACK");
      throw transactionError;
    }

  } catch (error) {
    console.error('Cancel order error:', error);
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

    if (userRole !== 'user') {
      return res.status(403).json({ success: false, message: "Only customers can clear their order history" });
    }

    // First, delete order items
    await pool.query(
      `DELETE oi FROM order_items oi
       INNER JOIN orders o ON oi.order_id = o.id
       WHERE o.user_id = ?`,
      [userId]
    );

    // Then delete orders
    const [result] = await pool.query(
      "DELETE FROM orders WHERE user_id = ?",
      [userId]
    );

    res.json({ 
      success: true, 
      message: "Order history cleared successfully",
      clearedCount: result.affectedRows
    });

  } catch (error) {
    console.error("Clear orders error:", error);
    res.status(500).json({ success: false, message: "Server error while clearing orders" });
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
    const validStatuses = ['pending', 'completed', 'cancelled', 'all'];
    if (!validStatuses.includes(status.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be one of: pending, completed, cancelled, all"
      });
    }

    // Build status condition
    let statusCondition = '';
    if (status === 'pending') {
      statusCondition = "AND o.status = 'Pending'";
    } else if (status === 'completed') {
      statusCondition = "AND o.status = 'Completed'";
    } else if (status === 'cancelled') {
      statusCondition = "AND o.status = 'Cancelled'";
    }

    const [orders] = await pool.execute(`
      SELECT 
        o.id,
        o.id as orderId,
        o.user_id as userId,
        CASE 
          WHEN o.has_timer = 1 THEN 'store_pickup'
          ELSE 'home_delivery'
        END as deliveryType,
        CASE 
          WHEN o.status = 'Completed' THEN 'completed'
          WHEN o.status = 'Cancelled' THEN 'cancelled'
          ELSE 'pending'
        END as status,
        o.status as originalStatus,
        o.total_amount as totalAmount,
        o.created_at as createdAt,
        s.shop_name as shopName,
        s.name as shopkeeperName
      FROM orders o
      LEFT JOIN shopkeepers s ON o.shopkeeper_id = s.id
      WHERE o.user_id = ? ${statusCondition}
      ORDER BY o.created_at DESC
    `, [userId]);

    // Get items for orders
    const orderIds = orders.map(o => o.id);
    let orderItems = [];
    
    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => '?').join(',');
      const [items] = await pool.execute(`
        SELECT 
          oi.order_id as orderId,
          oi.product_id as productId,
          oi.quantity,
          oi.price,
          p.name as productName
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id IN (${placeholders})
      `, orderIds);
      
      orderItems = items;
    }

    const ordersWithItems = orders.map(order => ({
      ...order,
      items: orderItems.filter(item => item.orderId === order.id),
      totalAmount: parseFloat(order.totalAmount)
    }));

    res.json({
      success: true,
      orders: ordersWithItems
    });

  } catch (error) {
    console.error('Get orders by status error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message
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

    const [orders] = await pool.execute(`
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
        END as deliveryType,
        CASE 
          WHEN o.status = 'Completed' THEN 'completed'
          WHEN o.status = 'Cancelled' THEN 'cancelled'
          WHEN o.status = 'Paid' THEN 'paid'
          ELSE 'pending'
        END as status,
        o.status as originalStatus,
        o.total_amount as totalAmount,
        o.total_amount as total_amount,
        o.payment_status,
        o.payment_method,
        o.delivery_address,
        o.pickup_code,
        o.created_at as createdAt,
        o.created_at as created_at,
        s.shop_name as shopName,
        s.shop_name as shop_name,
        s.name as shopkeeperName,
        s.upi_id as shop_upi
      FROM orders o
      LEFT JOIN shopkeepers s ON o.shopkeeper_id = s.id
      WHERE o.id = ? AND (o.user_id = ? OR o.shopkeeper_id = ? OR ? IN (SELECT id FROM admins))
    `, [orderId, userId, userId, userId]);

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    const order = orders[0];

    // Get items for this order
    const [items] = await pool.execute(`
      SELECT 
        oi.product_id as productId,
        oi.product_id as product_id,
        oi.quantity,
        oi.price,
        p.name as productName,
        p.name as name
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `, [orderId]);

    res.json({
      success: true,
      order: {
        ...order,
        items,
        totalAmount: parseFloat(order.totalAmount)
      }
    });

  } catch (error) {
    console.error('Get order details error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch order details",
      error: error.message
    });
  }
});

// GET /api/orders/:orderId/timer
router.get("/:orderId/timer", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId } = req.params;

    const [timerInfo] = await pool.query(`
      SELECT o.id, o.status, o.has_timer, o.pickup_code, o.timer_started_at, o.timer_expires_at,
             ot.timer_duration, ot.is_active, ot.is_expired, ot.stopped_at,
             s.shop_name, s.name as shopkeeperName, s.phone as shopkeeperPhone, 
             s.address as shopAddress, s.latitude as shopLatitude, s.longitude as shopLongitude
      FROM orders o
      LEFT JOIN order_timers ot ON o.id = ot.order_id
      LEFT JOIN shopkeepers s ON o.shopkeeper_id = s.id
      WHERE o.id = ? AND o.user_id = ?
    `, [orderId, userId]);

    if (timerInfo.length === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
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
          shopLongitude: timer.shopLongitude
        }
      }
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

    const [orderInfo] = await pool.query(`
      SELECT id, id as orderId, status, has_timer, pickup_code, timer_started_at, timer_expires_at,
             total_amount as totalAmount, created_at as createdAt, credits_earned as creditsEarned
      FROM orders 
      WHERE id = ? AND user_id = ?
    `, [orderId, userId]);

    if (orderInfo.length === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    res.json({ success: true, order: orderInfo[0] });
  } catch (err) {
    console.error("Get order status error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ============================================================================
// CREATE NEW ORDER
// ============================================================================
// POST /api/orders
router.post("/", verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    const userId = req.user.id;
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
      paymentMethod = 'cod',
      deliveryAddress: reqDeliveryAddress,
      address,
      latitude = null,
      longitude = null,
      creditsUsed: reqCreditsUsed,
      pointsToRedeem,
      scheduled_time: reqScheduledTime
    } = req.body;

    // Use aliases if main fields are missing
    const items = reqItems || products;
    const deliveryType = reqDeliveryType || order_type || 'home_delivery';
    const totalAmount = reqTotalAmount || grandTotal || total;
    const shopkeeperId = reqShopkeeperId || shopId;
    const deliveryAddress = reqDeliveryAddress || address || null;
    const creditsUsed = reqCreditsUsed || pointsToRedeem || 0;
    const scheduledTime = reqScheduledTime || req.body.scheduledTime || null;

    // Validate required fields
    if (!items || !Array.isArray(items) || items.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Items array is required and cannot be empty"
      });
    }

    if (!totalAmount || totalAmount <= 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Valid total amount is required"
      });
    }

    if (!shopkeeperId) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Shopkeeper ID is required"
      });
    }

    // Validate stock availability BEFORE creating order
    const stockCheck = await validateStockAvailability(items, connection);
    if (!stockCheck.available) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Some items are out of stock',
        unavailableItems: stockCheck.unavailableItems
      });
    }

    // Determine if this is a store pickup order
    const hasTimer = deliveryType === 'store_pickup' ? 1 : 0;
    const pickupCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Handle wellness points redemption if requested
    let pointsDiscount = 0;
    if (creditsUsed > 0) {
      try {
        const [[user]] = await connection.execute('SELECT store_credits FROM users WHERE id = ?', [userId]);
        if (!user) {
          await connection.rollback();
          return res.status(404).json({ success: false, message: "User not found" });
        }

        const validation = validatePointsUsage(creditsUsed, user.store_credits || 0, totalAmount);
        if (!validation.valid) {
          await connection.rollback();
          return res.status(400).json({ success: false, message: validation.message });
        }

        const pointsResult = await deductWellnessPoints(connection, userId, creditsUsed);
        pointsDiscount = pointsResult.discountAmount;
      } catch (pointsError) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: pointsError.message });
      }
    }

    const finalTotal = totalAmount - pointsDiscount;

    // Get next order ID (TiDB doesn't support auto-increment reliably)
    const [maxOrderId] = await connection.execute("SELECT COALESCE(MAX(id), 0) + 1 as nextId FROM orders");
    const orderId = maxOrderId[0].nextId;

    // Calculate credits earned (1% of total amount)
    const creditsEarned = Math.floor(finalTotal * 0.01);

    // Precompute timer timestamps for click & collect
    const now = new Date();
    const timerStartedAt = hasTimer ? now : null;
    const timerExpiresAt = hasTimer ? new Date(now.getTime() + TIMER_DURATION_SECONDS * 1000) : null;

    // Insert order
    await connection.execute(`
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
      ) VALUES (?, ?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
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
      (deliveryType === 'store_pickup' || deliveryType === 'pickup') ? 'pickup' : 'delivery',
      (deliveryType === 'store_pickup' || deliveryType === 'pickup') ? 'pickup' : 'delivery',
      scheduledTime
    ]);

    // Create timer record in order_timers table (only for pickup orders)
    if (hasTimer) {
      try {
        await connection.execute(`
          INSERT INTO order_timers (order_id, pickup_code, timer_duration, timer_started_at, timer_expires_at, is_active)
          VALUES (?, ?, ?, ?, ?, TRUE)
        `, [orderId, pickupCode, TIMER_DURATION_SECONDS, timerStartedAt, timerExpiresAt]);
      } catch (timerError) {
        console.warn("Timer record creation failed:", timerError.message);
      }
    }

    // Insert order items
    for (const item of items) {
      const productId = item.productId || item.product_id;
      const quantity = item.quantity || item.qty || 1;
      const price = item.price || 0;

      if (!productId) {
        console.warn("Skipping item with missing productId", item);
        continue;
      }

      const [maxItemId] = await connection.execute("SELECT COALESCE(MAX(id), 0) + 1 as nextId FROM order_items");
      const itemId = maxItemId[0].nextId;
      
      await connection.execute(`
        INSERT INTO order_items (id, order_id, product_id, quantity, price)
        VALUES (?, ?, ?, ?, ?)
      `, [itemId, orderId, productId, quantity, price]);

      // Reduce stock
      await connection.execute(`
        UPDATE products 
        SET stock = stock - ? 
        WHERE id = ? AND stock >= ?
      `, [quantity, productId, quantity]);
    }

    // Deduct inventory stock for order items
    await onOrderCreated(orderId, connection);

    await connection.commit();

    // Compute delivery slot (next 12 hours in 30-minute windows)
    const computeNextDeliverySlot = (baseDate) => {
      const start = new Date(baseDate);
      const minutes = start.getMinutes();
      const roundedMinutes = minutes % TIME_SLOT_CONFIG.INTERVAL_MINUTES === 0 
        ? minutes 
        : minutes + (TIME_SLOT_CONFIG.INTERVAL_MINUTES - (minutes % TIME_SLOT_CONFIG.INTERVAL_MINUTES));
      start.setMinutes(roundedMinutes, 0, 0);
      const end = new Date(start.getTime() + TIME_SLOT_CONFIG.INTERVAL_MINUTES * 60 * 1000);
      const limit = new Date(baseDate.getTime() + 12 * 60 * 60 * 1000);
      if (start > limit) {
        // If beyond 12 hours, cap at limit window
        start.setTime(limit.getTime());
        end.setTime(limit.getTime() + TIME_SLOT_CONFIG.INTERVAL_MINUTES * 60 * 1000);
      }
      const label = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      return { startISO: start.toISOString(), endISO: end.toISOString(), label };
    };

    const deliverySlot = deliveryType === 'home_delivery' ? computeNextDeliverySlot(now) : null;

    // Socket broadcast to shopkeeper and customer rooms
    try {
      // Get shopkeeper details for the payload (including coordinates and push token)
      const [shopkeeperDetails] = await connection.execute(
        "SELECT shop_name, name, phone, address, latitude, longitude, expo_push_token FROM shopkeepers WHERE id = ?",
        [shopkeeperId]
      );

      const shopkeeper = shopkeeperDetails[0] || {};

      // Get product details for items
      const itemsWithDetails = [];
      for (const item of items) {
        const productId = item.productId || item.product_id;
        const quantity = item.quantity || item.qty || 1;
        const price = item.price || 0;

        if (!productId) continue;

        const [productDetails] = await connection.execute(
          "SELECT name, image, category FROM products WHERE id = ?",
          [productId]
        );
        const product = productDetails[0] || {};
        itemsWithDetails.push({
          productId: productId,
          productName: product.name || 'Unknown Product',
          productImage: product.image || null,
          productCategory: product.category || null,
          quantity: quantity,
          price: parseFloat(price) || 0
        });
      }

      const payload = {
        id: orderId,
        orderId: orderId,
        order_id: orderId, // Add for compatibility
        userId,
        user_id: userId, // Add for compatibility
        shopkeeperId,
        shopkeeper_id: shopkeeperId, // Add for compatibility
        deliveryType,
        delivery_type: deliveryType, // Add for compatibility
        orderType: (deliveryType === 'store_pickup' || deliveryType === 'pickup') ? 'pickup' : 'delivery',
        order_type: (deliveryType === 'store_pickup' || deliveryType === 'pickup') ? 'pickup' : 'delivery',
        deliveryMode: (deliveryType === 'store_pickup' || deliveryType === 'pickup') ? 'pickup' : 'delivery',
        delivery_mode: (deliveryType === 'store_pickup' || deliveryType === 'pickup') ? 'pickup' : 'delivery',
        status: 'pending',
        originalStatus: 'Pending',
        totalAmount: parseFloat(finalTotal),
        total_amount: parseFloat(finalTotal), // Add for compatibility
        creditsEarned,
        credits_earned: creditsEarned, // Add for compatibility
        creditsUsed,
        credits_used: creditsUsed, // Add for compatibility
        pickupCode,
        pickup_code: pickupCode, // Add for compatibility
        hasTimer: hasTimer === 1,
        has_timer: hasTimer === 1, // Add for compatibility
        timerStartedAt: timerStartedAt ? timerStartedAt.toISOString() : null,
        timer_started_at: timerStartedAt ? timerStartedAt.toISOString() : null, // Add for compatibility
        timerExpiresAt: timerExpiresAt ? timerExpiresAt.toISOString() : null,
        timer_expires_at: timerExpiresAt ? timerExpiresAt.toISOString() : null, // Add for compatibility
        deliverySlot,
        delivery_slot: deliverySlot, // Add for compatibility
        deliveryAddress,
        delivery_address: deliveryAddress, // Add for compatibility
        latitude,
        longitude,
        paymentMethod,
        payment_method: paymentMethod, // Add for compatibility
        createdAt: now.toISOString(),
        created_at: now.toISOString(), // Add for compatibility
        shopName: shopkeeper.shop_name,
        shop_name: shopkeeper.shop_name, // Add for compatibility
        shopkeeperName: shopkeeper.name,
        shopkeeper_name: shopkeeper.name, // Add for compatibility
        shopkeeperPhone: shopkeeper.phone,
        shopkeeper_phone: shopkeeper.phone, // Add for compatibility
        shopAddress: shopkeeper.address,
        shop_address: shopkeeper.address, // Add for compatibility
        shopLatitude: shopkeeper.latitude,
        shop_latitude: shopkeeper.latitude, // Add for compatibility
        shopLongitude: shopkeeper.longitude,
        shop_longitude: shopkeeper.longitude, // Add for compatibility
        items: itemsWithDetails,
        // Add timer info for click & collect
        timerInfo: hasTimer === 1 ? {
          hasTimer: true,
          pickupCode,
          timerStartedAt: timerStartedAt ? timerStartedAt.toISOString() : null,
          timerExpiresAt: timerExpiresAt ? timerExpiresAt.toISOString() : null,
          isExpired: false
        } : null
      };

      console.log(`📡 Socket: Broadcasting new order ${orderId} to shopkeeper ${shopkeeperId} and customer ${userId}`);
      
      // Emit events used by clients
      if (req.io) {
        const shopRoom = `shop_${Number(shopkeeperId)}`;
        const customerRoom = `customer_${Number(userId)}`;
        
        req.io.to(shopRoom).emit('newOrder', payload);
        req.io.to(shopRoom).emit('orderCreated', payload);
        req.io.to(customerRoom).emit('newOrder', payload);
        req.io.to(customerRoom).emit('orderCreated', payload);
        req.io.to('admin').emit('newOrder', payload);
      }

      // Send push notification to shopkeeper
      if (shopkeeper.expo_push_token) {
        const token = shopkeeper.expo_push_token;
        const title = "📦 New Order Received!";
        const body = `You have a new order (#${orderId}) worth ₹${finalTotal.toFixed(2)}.`;
        const payload = { orderId: String(orderId), shopId: String(shopkeeperId) };

        try {
          if (isFCMToken(token)) {
            await sendFCMPush(token, title, body, payload);
          } else {
            await sendExpoPush(token, title, body, payload);
          }
        } catch (pushErr) {
          console.error(`Failed to send push to shopkeeper ${shopkeeperId}:`, pushErr);
        }
      }

      // Send push notification to customer (Order Confirmed)
      const [customerRows] = await connection.execute("SELECT expo_push_token FROM users WHERE id = ?", [userId]);
      const customer = customerRows[0];
      if (customer && customer.expo_push_token) {
        const token = customer.expo_push_token;
        const title = "Order Placed Successfully!";
        const body = `Your order #${orderId} has been placed. You can track it in the app.`;
        const payload = { orderId: String(orderId), status: 'Pending' };

        try {
          if (isFCMToken(token)) {
            await sendFCMPush(token, title, body, payload);
          } else {
            await sendExpoPush(token, title, body, payload);
          }
        } catch (pushErr) {
          console.error(`Failed to send push to customer ${userId}:`, pushErr);
        }
      }

    } catch (notifyErr) {
      console.error("Error notifying shopkeeper:", notifyErr);
    }

    res.json({
      success: true,
      message: "Order placed successfully",
      order: {
        id: orderId,
        orderId,
        totalAmount: finalTotal,
        pickupCode
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Create order error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to create order",
      error: error.message
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
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    // Validate status
    const validStatuses = ['pending', 'completed', 'cancelled', 'paid', 'processing'];
    if (!validStatuses.includes(status.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be one of: " + validStatuses.join(", ")
      });
    }

    // Map frontend status to database status
    const statusMap = {
      'pending': 'Pending',
      'completed': 'Completed',
      'cancelled': 'Cancelled',
      'paid': 'Paid',
      'processing': 'Processing'
    };
    const dbStatus = statusMap[status.toLowerCase()];

    // Check if order exists and get details for authorization and notifications
    const [orderRows] = await pool.execute(`
      SELECT id, status, user_id, shopkeeper_id, total_amount, has_timer, timer_started_at, order_type, delivery_mode
      FROM orders 
      WHERE id = ?
    `, [orderIdNum]);

    if (orderRows.length === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const order = orderRows[0];

    // Authorization check
    if (userRole === 'user' && order.user_id !== userId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    } else if (userRole === 'shopkeeper' && order.shopkeeper_id !== userId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    } else if (userRole !== 'user' && userRole !== 'shopkeeper' && userRole !== 'admin') {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // Business Logic: Handle specific status transitions
    if (dbStatus === 'Cancelled') {
      console.log(`📦 Order ${orderIdNum} being cancelled by ${userRole}`);
      
      await pool.query("START TRANSACTION");
      try {
        await pool.query("UPDATE orders SET status = 'Cancelled', cancellation_reason = ? WHERE id = ?", 
          [cancellation_reason || `${userRole} cancellation`, orderIdNum]);
        
        // Stop timer
        await pool.query(`
          UPDATE order_timers 
          SET is_active = FALSE, stopped_at = NOW(), is_expired = FALSE
          WHERE order_id = ? AND is_active = TRUE
        `, [orderIdNum]);

        // Restore stock
        await restoreStockForCancelledOrder(orderIdNum, userRole, cancellation_reason);

        // Refund credits if any
        const [[creditsData]] = await pool.query("SELECT credits_used FROM orders WHERE id = ?", [orderIdNum]);
        if (creditsData?.credits_used > 0) {
          await pool.query("UPDATE users SET store_credits = COALESCE(store_credits, 0) + ? WHERE id = ?", 
            [creditsData.credits_used, order.user_id]);
        }

        await pool.query("COMMIT");
      } catch (err) {
        await pool.query("ROLLBACK");
        throw err;
      }
    } else if (dbStatus === 'Completed') {
      await pool.query("UPDATE orders SET status = 'Completed' WHERE id = ?", [orderIdNum]);
      
      // Award wellness points
      try {
        const orderType = order.order_type || order.delivery_mode || 'pickup';
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
      await pool.query("UPDATE orders SET status = ? WHERE id = ?", [dbStatus, orderIdNum]);
    }

    // Socket Notification
    if (req.io) {
      const payload = {
        orderId: orderIdNum,
        order_id: orderIdNum,
        status: dbStatus,
        updatedAt: new Date().toISOString()
      };
      req.io.to(`shop_${order.shopkeeper_id}`).emit("orderStatusUpdate", payload);
      req.io.to(`customer_${order.user_id}`).emit("orderStatusUpdate", payload);
      req.io.to('admin').emit("orderStatusUpdate", payload);
    }

    // Push Notification
    try {
      const targetId = userRole === 'user' ? order.shopkeeper_id : order.user_id;
      const targetTable = userRole === 'user' ? 'shopkeepers' : 'users';
      const [[target]] = await pool.query(`SELECT expo_push_token FROM ${targetTable} WHERE id = ?`, [targetId]);
      
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
          console.error(`Failed to send status update push to ${targetTable}:`, pushErr);
        }
      }
    } catch (pushErr) {
      console.error("Error sending push:", pushErr);
    }

    res.json({ success: true, message: `Order status updated to ${dbStatus}`, status: dbStatus });

  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ success: false, message: "Failed to update status" });
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
    user: req.user
  });
});

router.post("/cart/add", handleCartTokenExpiration, verifyToken, (req, res) => {
  res.json({
    success: true,
    message: "Item added to cart",
    user: req.user
  });
});

// Apply order error handler
router.use(orderErrorHandler);

export default router;
