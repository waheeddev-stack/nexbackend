import express from "express";
import verifyToken from "../middleware/auth.js";
import { handleOrderTokenExpiration, handleCartTokenExpiration, orderErrorHandler } from "../middleware/orderErrorHandler.js";
import { refreshTokenIfNeeded } from "../middleware/tokenRefresh.js";
import pool from "../config/db.js";

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
        whereConditions.push("o.status IN ('Pending', 'Processing')");
      } else if (status === 'completed') {
        whereConditions.push("o.status IN ('Completed', 'Delivered')");
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
        SUM(CASE WHEN o.status IN ('Pending', 'Processing') THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN o.status IN ('Completed', 'Delivered') THEN 1 ELSE 0 END) as completed_count,
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
          WHEN o.status IN ('Completed', 'Delivered') THEN 'completed'
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
      creditsUsed: parseInt(order.creditsUsed || 0)
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
      statusCondition = "AND o.status IN ('Pending', 'Processing')";
    } else if (status === 'completed') {
      statusCondition = "AND o.status IN ('Completed', 'Delivered')";
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
          WHEN o.status IN ('Completed', 'Delivered') THEN 'completed'
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

    // Determine if this is a store pickup order
    const hasTimer = deliveryType === 'store_pickup' ? 1 : 0;
    const pickupCode = hasTimer ? Math.floor(100000 + Math.random() * 900000).toString() : null;

    // Calculate credits earned (1% of total amount)
    const creditsEarned = Math.floor(totalAmount * 0.01);

    // Insert order
    const [orderResult] = await connection.execute(`
      INSERT INTO orders (
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
        pickup_code
      ) VALUES (?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId, 
      shopkeeperId, 
      paymentMethod,
      totalAmount, 
      creditsEarned,
      creditsUsed,
      deliveryAddress,
      latitude,
      longitude,
      hasTimer,
      pickupCode
    ]);

    const orderId = orderResult.insertId;

    // Insert order items
    for (const item of items) {
      await connection.execute(`
        INSERT INTO order_items (order_id, product_id, quantity, price)
        VALUES (?, ?, ?, ?)
      `, [orderId, item.productId, item.quantity, item.price]);

      // Reduce stock
      await connection.execute(`
        UPDATE products 
        SET stock = stock - ? 
        WHERE id = ? AND stock >= ?
      `, [item.quantity, item.productId, item.quantity]);
    }

    await connection.commit();

    res.status(201).json({
      success: true,
      message: "Order created successfully",
      order: {
        id: orderId,
        orderId: orderId,
        userId,
        deliveryType,
        status: 'pending',
        totalAmount: parseFloat(totalAmount),
        creditsEarned,
        pickupCode,
        hasTimer: hasTimer === 1
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
