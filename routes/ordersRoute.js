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
import { validatePointsUsage, deductWellnessPoints } from '../utils/wellnessPoints.js';
import { sendExpoPush, sendFCMPush, isFCMToken } from '../utils/expoPush.js';

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
    const { status = 'all', deliveryType } = req.query;

    // Build WHERE clause for filtering
    let whereConditions = ['o.user_id = ?'];
    let queryParams = [userId];

    // Add status filter (map UI status to DB status)
    if (status && status !== 'all') {
      if (status === 'pending') {
        whereConditions.push("o.status = 'Pending'");
      } else if (status === 'completed') {
        whereConditions.push("o.status = 'Completed'");
      } else if (status === 'cancelled') {
        whereConditions.push("o.status = 'Cancelled'");
      }
    }

    // Add delivery type filter (check if has_timer field exists)
    if (deliveryType) {
      if (deliveryType === 'store_pickup') {
        whereConditions.push('o.has_timer = 1');
      } else if (deliveryType === 'home_delivery') {
        whereConditions.push('(o.has_timer = 0 OR o.has_timer IS NULL)');
      }
    }

    const whereClause = whereConditions.join(' AND ');

    // Get counts for all statuses (respecting deliveryType filter)
    let countWhereConditions = ['o.user_id = ?'];
    let countParams = [userId];
    
    if (deliveryType) {
      if (deliveryType === 'store_pickup') {
        countWhereConditions.push('o.has_timer = 1');
      } else if (deliveryType === 'home_delivery') {
        countWhereConditions.push('(o.has_timer = 0 OR o.has_timer IS NULL)');
      }
    }
    
    const countWhereClause = countWhereConditions.join(' AND ');

    const [counts] = await pool.execute(`
      SELECT 
        COUNT(*) as all_count,
        SUM(CASE WHEN o.status = 'Pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN o.status = 'Completed' THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN o.status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled_count
      FROM orders o
      WHERE ${countWhereClause}
    `, countParams);

    // Get filtered orders with shopkeeper and items details
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
      WHERE ${whereClause}
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

    // Attach items to each order
    const ordersWithItems = orders.map(order => ({
      ...order,
      items: orderItems.filter(item => item.orderId === order.id).map(item => ({
        productId: item.productId,
        productName: item.productName,
        productImage: item.productImage,
        productCategory: item.productCategory,
        quantity: item.quantity,
        price: parseFloat(item.price)
      })),
      totalAmount: parseFloat(order.totalAmount),
      creditsEarned: parseFloat(order.creditsEarned || 0),
      creditsUsed: parseInt(order.creditsUsed || 0),
      // Attach computed delivery slot for home delivery (ephemeral if not stored)
      deliverySlot: order.deliveryType === 'home_delivery' ? (() => {
        const created = order.createdAt ? new Date(order.createdAt) : new Date();
        const start = new Date(created);
        const minutes = start.getMinutes();
        const roundedMinutes = minutes % TIME_SLOT_CONFIG.INTERVAL_MINUTES === 0 
          ? minutes 
          : minutes + (TIME_SLOT_CONFIG.INTERVAL_MINUTES - (minutes % TIME_SLOT_CONFIG.INTERVAL_MINUTES));
        start.setMinutes(roundedMinutes, 0, 0);
        const end = new Date(start.getTime() + TIME_SLOT_CONFIG.INTERVAL_MINUTES * 60 * 1000);
        const label = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        return { startISO: start.toISOString(), endISO: end.toISOString(), label };
      })() : null
    }));

    res.json({
      success: true,
      counts: {
        all: parseInt(counts[0].all_count) || 0,
        pending: parseInt(counts[0].pending_count) || 0,
        completed: parseInt(counts[0].completed_count) || 0,
        cancelled: parseInt(counts[0].cancelled_count) || 0
      },
      orders: ordersWithItems
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
      WHERE o.id = ? AND (o.user_id = ? OR ? IN (SELECT id FROM admins))
    `, [orderId, userId, userId]);

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
    const { 
      items, 
      deliveryType = 'home_delivery', 
      totalAmount,
      shopkeeperId,
      paymentMethod = 'cod',
      deliveryAddress,
      latitude,
      longitude,
      creditsUsed = 0
    } = req.body;

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
        created_at
      ) VALUES (?, ?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
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
      timerExpiresAt
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
      const [maxItemId] = await connection.execute("SELECT COALESCE(MAX(id), 0) + 1 as nextId FROM order_items");
      const itemId = maxItemId[0].nextId;
      
      await connection.execute(`
        INSERT INTO order_items (id, order_id, product_id, quantity, price)
        VALUES (?, ?, ?, ?, ?)
      `, [itemId, orderId, item.productId, item.quantity, item.price]);

      // Reduce stock
      await connection.execute(`
        UPDATE products 
        SET stock = stock - ? 
        WHERE id = ? AND stock >= ?
      `, [item.quantity, item.productId, item.quantity]);
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
        const [productDetails] = await connection.execute(
          "SELECT name, image, category FROM products WHERE id = ?",
          [item.productId]
        );
        const product = productDetails[0] || {};
        itemsWithDetails.push({
          productId: item.productId,
          productName: product.name || 'Unknown Product',
          productImage: product.image || null,
          productCategory: product.category || null,
          quantity: item.quantity,
          price: parseFloat(item.price)
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
        if (isFCMToken(token)) {
          await sendFCMPush(token, "📦 New Order Received!", `You have a new order (#${orderId}) worth ₹${finalTotal.toFixed(2)}.`, { orderId: String(orderId), shopId: String(shopkeeperId) });
        } else {
          await sendExpoPush(token, "📦 New Order Received!", `You have a new order (#${orderId}) worth ₹${finalTotal.toFixed(2)}.`, { orderId, shopId: shopkeeperId });
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
    const { status } = req.body;
    const userId = req.user.id;

    // Validate status
    const validStatuses = ['completed', 'cancelled'];
    if (!validStatuses.includes(status.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be 'completed' or 'cancelled'"
      });
    }

    // Map frontend status to database status
    const dbStatus = status === 'completed' ? 'Completed' : 'Cancelled';

    // Check if order exists and belongs to user
    const [orders] = await pool.execute(`
      SELECT id, status, user_id 
      FROM orders 
      WHERE id = ? AND user_id = ?
    `, [orderId, userId]);

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    // Update order status
    await pool.execute(`
      UPDATE orders 
      SET status = ? 
      WHERE id = ? AND user_id = ?
    `, [dbStatus, orderId, userId]);

    // Handle order cancellation: restore stock and refund credits
    if (dbStatus === 'Cancelled') {
      // Restore inventory stock
      await onOrderCancelled(orderId, 'USER_CANCELLED');
      
      // Refund any credits that were used in this order
      try {
        const [orderData] = await pool.execute(
          "SELECT credits_used FROM orders WHERE id = ? AND user_id = ?",
          [orderId, userId]
        );
        
        if (orderData.length > 0 && orderData[0].credits_used > 0) {
          const creditsUsed = orderData[0].credits_used;
          console.log(`Refunding ${creditsUsed} credits to user ${userId} for cancelled order ${orderId}`);
          
          // Refund the credits back to user
          await pool.execute(
            'UPDATE users SET store_credits = COALESCE(store_credits, 0) + ? WHERE id = ?',
            [creditsUsed, userId]
          );
          
          console.log(`Credits refunded successfully for order ${orderId}`);
        }
      } catch (refundError) {
        console.error("Error refunding credits:", refundError);
        // Don't fail the cancellation if refund fails
      }
    }

    // Socket broadcast status update
    try {
      // Get order details for proper broadcasting
      const [orderDetails] = await pool.execute(
        "SELECT shopkeeper_id, user_id, total_amount, has_timer FROM orders WHERE id = ?",
        [orderId]
      );

      if (orderDetails.length > 0) {
        const shopkeeperId = orderDetails[0].shopkeeper_id;
        const orderUserId = orderDetails[0].user_id;
        const payload = { 
          orderId: parseInt(orderId),
          order_id: parseInt(orderId), // Add for compatibility
          status: status.toLowerCase(),
          originalStatus: dbStatus,
          userId: orderUserId,
          user_id: orderUserId, // Add for compatibility
          shopkeeperId: shopkeeperId,
          shopkeeper_id: shopkeeperId, // Add for compatibility
          totalAmount: parseFloat(orderDetails[0].total_amount),
          total_amount: parseFloat(orderDetails[0].total_amount), // Add for compatibility
          hasTimer: orderDetails[0].has_timer === 1,
          has_timer: orderDetails[0].has_timer === 1, // Add for compatibility
          updatedAt: new Date().toISOString(),
          updated_at: new Date().toISOString() // Add for compatibility
        };
        
        console.log(`📡 Socket: Broadcasting order status update - orderId: ${orderId}, status: ${status}`);
        console.log(`📡 Socket: Shopkeeper: ${shopkeeperId}, Customer: ${orderUserId}`);
        
        if (req.io) {
          // Broadcast to shopkeeper room
          const shopRoom = `shop_${Number(shopkeeperId)}`;
          console.log(`📡 Socket: Emitting orderStatusUpdate to ${shopRoom}`);
          req.io.to(shopRoom).emit('orderStatusUpdate', payload);
          
          // Broadcast to customer room
          const customerRoom = `customer_${Number(orderUserId)}`;
          console.log(`📡 Socket: Emitting orderStatusUpdate to ${customerRoom}`);
          req.io.to(customerRoom).emit('orderStatusUpdate', payload);
          
          // Also emit to admin room
          console.log(`📡 Socket: Emitting orderStatusUpdate to admin room`);
          req.io.to('admin').emit('orderStatusUpdate', payload);
          
          console.log(`📡 Socket: Order status update broadcast completed successfully`);
        } else {
          console.warn('📡 Socket: req.io not available - status updates will not sync in real-time!');
        }
      }
    } catch (_socketErr) {
      console.error('📡 Socket: Error broadcasting order status update:', _socketErr);
      console.error('📡 Socket: Stack trace:', _socketErr.stack);
    }

    res.json({
      success: true,
      message: `Order ${status} successfully`,
      order: {
        id: parseInt(orderId),
        status: status.toLowerCase()
      }
    });

  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update order status",
      error: error.message
    });
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
