import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import express from "express";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import cloudinary from "../config/cloudinary.js";
import pool from "../config/db.js";
import { sendExpoPush } from "../utils/expoPush.js";
import { sendFCMPush, isFCMToken } from "../utils/fcmPush.js";
import upload from "../config/upload.js";
import verifyToken from "../middleware/auth.js";
import { checkSubscriptionStatus } from "../middleware/checkSubscription.js";
// import checkPaymentStatus from "../middleware/checkPaymentStatus.js"; // Disabled - earnings system not implemented
import { awardWellnessPoints } from "../utils/wellnessPoints.js";
import { 
  calculateSubscriptionStatus, 
  updateSubscriptionStatus, 
  processPaymentApproval,
  canAccessApp 
} from "../utils/subscription.js";
import { createJWEToken } from "../utils/jweToken.js";
import { restoreStockForCancelledOrder } from "../utils/stockManager.js";

// Middleware to check if shopkeeper is verified (compatible with existing database)
const verifyShopkeeperStatus = async (req, res, next) => {
  try {
    const [user] = await pool.query(
      "SELECT * FROM shopkeepers WHERE id = ?",
      [req.user.id]
    );

    if (user.length === 0) {
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
    }

    // Check verification status with proper handling for all states
    const shopkeeper = user[0];
    const verificationStatus = shopkeeper.is_verified;
    
    if (verificationStatus === 0) {
      // Rejected
      return res.status(403).json({ 
        success: false, 
        message: "Your account has been denied. Please contact support for more information.",
        verification_status: 'rejected'
      });
    } else if (verificationStatus === null || verificationStatus === '' || verificationStatus === undefined) {
      // Pending
      return res.status(403).json({ 
        success: false, 
        message: "Your account is pending verification. Please wait for admin approval.",
        verification_status: 'pending'
      });
    } else if (verificationStatus !== 1) {
      // Any other invalid status
      return res.status(403).json({ 
        success: false, 
        message: "Your account verification status is unclear. Please contact support.",
        verification_status: 'unknown'
      });
    }
    
    // Only approved shopkeepers (is_verified = 1) can proceed

    next();
  } catch (err) {
    console.error("Verification check error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
dotenv.config();

const shopkeeperRouter = express.Router();

shopkeeperRouter.get("/stats", verifyToken, verifyShopkeeperStatus, checkSubscriptionStatus, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    
      // Get top selling product for this specific shopkeeper (products table contains shop_id)
      const [[topProduct]] = await pool.query(`
        SELECT p.name, SUM(oi.quantity) AS sold
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        JOIN orders o ON oi.order_id = o.id
        WHERE o.shopkeeper_id = ? AND p.shop_id = ?
        GROUP BY p.id
        ORDER BY sold DESC
        LIMIT 1
      `, [shopkeeper_id, shopkeeper_id]);

    // Get stats for this specific shopkeeper only
    const [[totalSales]] = await pool.query(
      "SELECT SUM(total_amount) AS totalSales FROM orders WHERE status='Completed' AND shopkeeper_id = ?",
      [shopkeeper_id]
    );
    const [[totalDelivered]] = await pool.query(
      "SELECT COUNT(*) AS totalDelivered FROM orders WHERE status='Completed' AND shopkeeper_id = ?",
      [shopkeeper_id]
    );
    const [[totalPending]] = await pool.query(
      "SELECT COUNT(*) AS totalPending FROM orders WHERE status='Pending' AND shopkeeper_id = ?",
      [shopkeeper_id]
    );
    const [[totalCancelled]] = await pool.query(
      "SELECT COUNT(*) AS totalCancelled FROM orders WHERE status='Cancelled' AND shopkeeper_id = ?",
      [shopkeeper_id]
    );
    const [[totalCompleted]] = await pool.query(
      "SELECT COUNT(*) AS totalCompleted FROM orders WHERE status IN ('Completed','Cancelled') AND shopkeeper_id = ?",
      [shopkeeper_id]
    );

    res.json({
      success: true,
      topSellingProduct: topProduct || { name: "-", sold: 0 },
      totalSales: totalSales?.totalSales || 0,
      totalDelivered: totalDelivered?.totalDelivered || 0,
      totalPending: totalPending?.totalPending || 0,
      totalCancelled: totalCancelled?.totalCancelled || 0,
      totalCompleted: totalCompleted?.totalCompleted || 0,
    });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// SHOPKEEPER SIGNUP - Handles both JSON and FormData
shopkeeperRouter.post("/signup", upload.single("img"), async (req, res) => {
  try {
    const { name, email, password, phone, shop_name, address, latitude, longitude } = req.body;

    // Validation
    if (!name || !email || !password || !phone || !shop_name) {
      return res.status(400).json({
        success: false,
        message: "Name, email, password, phone, and shop_name are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: "Password must be at least 6 characters" 
      });
    }

    // Check if shopkeeper already exists
    const [existingUser] = await pool.query(
      "SELECT id FROM shopkeepers WHERE email = ?", 
      [email]
    );
    
    if (existingUser.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Shopkeeper already exists" 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Get the next available ID (since auto-increment isn't working)
    const [maxIdResult] = await pool.query("SELECT MAX(id) as maxId FROM shopkeepers");
    const nextId = (maxIdResult[0].maxId || 0) + 1;

    // Parse latitude and longitude if provided
    const lat = latitude ? parseFloat(latitude) : null;
    const lng = longitude ? parseFloat(longitude) : null;
    const addr = address && address.trim() ? address.trim() : null;

    // Handle optional image upload
    let imgUrl = null;
    if (req.file) {
      try {
        const streamifier = await import('streamifier');
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream({ folder: "shopkeepers" }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
          });
          streamifier.default.createReadStream(req.file.buffer).pipe(stream);
        });
        imgUrl = result.secure_url;
      } catch (uploadErr) {
        console.error("Image upload error during signup:", uploadErr);
        // Continue without image - don't fail signup
      }
    }

    // Insert new shopkeeper with explicit ID, including address, coordinates, and image
    const [result] = await pool.query(
      `INSERT INTO shopkeepers (id, name, email, password, phone, shop_name, address, latitude, longitude, img) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nextId, name, email, hashedPassword, phone, shop_name, addr, lat, lng, imgUrl]
    );

    console.log('Insert result:', result);

    // Get the created shopkeeper
    const [userRows] = await pool.query(
      "SELECT id, name, email, phone, shop_name FROM shopkeepers WHERE id = ?",
      [nextId]
    );

    console.log('User rows:', userRows);

    if (!userRows || userRows.length === 0) {
      throw new Error('Failed to retrieve created shopkeeper');
    }

    const user = userRows[0];
    
    // Generate JWE token
    const token = await createJWEToken({ 
      id: user.id, 
      role: 'shopkeeper',
      email: user.email 
    }, '7d');

    return res.json({ 
      success: true, 
      token,
      user,
      shopkeeper: user,
      message: "Shopkeeper registered successfully. Please wait for admin verification."
    });
  } catch (err) {
    console.error("Shopkeeper signup error:", err);
    return res.status(500).json({ 
      success: false, 
      message: process.env.NODE_ENV === 'development' ? err.message : "Server error",
      error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// SHOPKEEPER LOGIN
shopkeeperRouter.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const [user] = await pool.query(
      "SELECT * FROM shopkeepers WHERE email = ?",
      [email]
    );

    if (user.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // Check if account is soft deleted
    if (user[0].is_deleted === 1) {
      return res.status(403).json({ 
        success: false, 
        message: "Your account has been deactivated. Please contact support for more information.",
        status: 'deleted'
      });
    }

    const validPass = await bcrypt.compare(password, user[0].password);
    if (!validPass) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // Check verification status with proper handling for all states
    const verificationStatus = user[0].is_verified;
    
    if (verificationStatus === 0) {
      // Rejected
      return res.status(403).json({ 
        success: false, 
        message: "Your account has been denied. Please contact support for more information.",
        status: 'rejected',
        verification_status: 'rejected'
      });
    } else if (verificationStatus === null || verificationStatus === '' || verificationStatus === undefined) {
      // Pending
      return res.status(403).json({ 
        success: false, 
        message: "Your account is pending verification. Please wait for admin approval.",
        status: 'pending',
        verification_status: 'pending'
      });
    } else if (verificationStatus !== 1) {
      // Any other invalid status
      return res.status(403).json({ 
        success: false, 
        message: "Your account verification status is unclear. Please contact support.",
        status: 'unknown',
        verification_status: 'unknown'
      });
    }
    
    // Only approved shopkeepers (is_verified = 1) can proceed

    const token = await createJWEToken({ 
      id: user[0].id, 
      role: 'shopkeeper',
      email: user[0].email 
    }, '7d');
    
    res.json({
      success: true,
      token,
      user: { 
        id: user[0].id, 
        email: user[0].email, 
        name: user[0].name, 
        shop_name: user[0].shop_name,
        is_verified: user[0].is_verified
      },
    });
  } catch (err) {
    console.error("Signin error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// SHOPKEEPER PROFILE - require auth and return extended fields
shopkeeperRouter.get("/profile/:id", verifyToken, async (req, res) => {
  try {
    const requestedId = parseInt(req.params.id);
    const authenticatedId = req.user.id;

    if (requestedId !== authenticatedId) {
      return res.status(403).json({ success: false, message: "Unauthorized: You can only access your own profile" });
    }

    const [user] = await pool.query(
      "SELECT id, email, name, phone, address, shop_name, img, upi_id, upi_qr, latitude, longitude, expo_push_token, is_verified, is_deleted, created_at FROM shopkeepers WHERE id = ?",
      [requestedId]
    );

    if (user.length === 0) {
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
    }

    // Check if account is deleted
    if (user[0].is_deleted === 1) {
      return res.status(403).json({ 
        success: false, 
        message: "Your account has been deactivated. Please contact support."
      });
    }

    res.json({ success: true, user: user[0], isComplete: !!(user[0].phone && user[0].address) });
  } catch (err) {
    console.error("Get profile error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// SHOPKEEPER UPDATE PROFILE - allow img and upi_qr upload, update expo_push_token and coords
shopkeeperRouter.put("/profile/:id", verifyToken, upload.fields([{ name: "img", maxCount: 1 }, { name: "upi_qr", maxCount: 1 }]), async (req, res) => {
  try {
    const requestedId = parseInt(req.params.id);
    const authenticatedId = req.user.id;

    if (requestedId !== authenticatedId) {
      return res.status(403).json({ success: false, message: "Unauthorized: You can only update your own profile" });
    }

    const { name, phone, address, shop_name, upi_id, expo_push_token, latitude, longitude } = req.body;
    let imgUrl = null;
    let upiQrUrl = null;

    if (phone && !/^\d{10}$/.test(phone)) {
      return res.status(400).json({ success: false, message: "Phone number must be 10 digits" });
    }

    // handle uploads
    try {
      const streamifier = await import('streamifier');

      if (req.files?.img && req.files.img[0]) {
        const file = req.files.img[0];
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream({ folder: "shopkeepers" }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
          });
          streamifier.default.createReadStream(file.buffer).pipe(stream);
        });
        imgUrl = result.secure_url;
      }

      if (req.files?.upi_qr && req.files.upi_qr[0]) {
        const file = req.files.upi_qr[0];
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream({ folder: "shopkeepers/upi_qr" }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
          });
          streamifier.default.createReadStream(file.buffer).pipe(stream);
        });
        upiQrUrl = result.secure_url;
      }
    } catch (uploadError) {
      console.error("Image upload error:", uploadError);
      return res.status(500).json({ success: false, message: "Failed to upload image(s)" });
    }

    const fields = [];
    const values = [];

    if (name && name.trim()) { fields.push("name = ?"); values.push(name.trim()); }
    if (phone) { fields.push("phone = ?"); values.push(phone); }
    if (address && address.trim()) { fields.push("address = ?"); values.push(address.trim()); }
    if (shop_name && shop_name.trim()) { fields.push("shop_name = ?"); values.push(shop_name.trim()); }
    if (upi_id !== undefined) { fields.push("upi_id = ?"); values.push(upi_id || null); }
    if (expo_push_token !== undefined) { fields.push("expo_push_token = ?"); values.push(expo_push_token || null); }
    if (latitude !== undefined) { fields.push("latitude = ?"); values.push(latitude || null); }
    if (longitude !== undefined) { fields.push("longitude = ?"); values.push(longitude || null); }
    if (imgUrl) { fields.push("img = ?"); values.push(imgUrl); }
    if (upiQrUrl) { fields.push("upi_qr = ?"); values.push(upiQrUrl); }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields to update" });
    }

    values.push(requestedId);
    const sql = `UPDATE shopkeepers SET ${fields.join(", ")} WHERE id = ?`;
    const [updateResult] = await pool.query(sql, values);

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
    }

    const [userRows] = await pool.query(
      "SELECT id, name, email, phone, address, shop_name, img, upi_id, upi_qr, latitude, longitude, expo_push_token, is_verified, created_at FROM shopkeepers WHERE id = ?",
      [requestedId]
    );

    res.json({ success: true, user: userRows[0], message: "Profile updated successfully" });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// SHOP ONLINE/OFFLINE STATUS TOGGLE
shopkeeperRouter.patch("/shop-status", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    const { is_online } = req.body;

    // Validate input
    if (typeof is_online !== 'boolean' && is_online !== 0 && is_online !== 1) {
      return res.status(400).json({ 
        success: false, 
        message: "is_online must be a boolean (true/false) or 0/1" 
      });
    }

    const onlineStatus = is_online ? 1 : 0;

    const [result] = await pool.query(
      "UPDATE shopkeepers SET is_online = ? WHERE id = ?",
      [onlineStatus, shopkeeper_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
    }

    res.json({ 
      success: true, 
      is_online: onlineStatus === 1,
      message: onlineStatus === 1 ? "Shop is now online and visible to customers" : "Shop is now offline and hidden from customers"
    });
  } catch (err) {
    console.error("Shop status toggle error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET SHOP STATUS
shopkeeperRouter.get("/shop-status", verifyToken, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;

    const [[shop]] = await pool.query(
      "SELECT is_online FROM shopkeepers WHERE id = ?",
      [shopkeeper_id]
    );

    if (!shop) {
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
    }

    res.json({ 
      success: true, 
      is_online: shop.is_online === 1 || shop.is_online === null // Default to online if null
    });
  } catch (err) {
    console.error("Get shop status error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// SHOPKEEPER ORDER ROUTES (get, update status)

// Get orders for a specific shopkeeper
shopkeeperRouter.get("/orders", verifyToken, verifyShopkeeperStatus, checkSubscriptionStatus, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    const { status } = req.query; // Optional filter by status

    console.log(`Fetching orders for shopkeeper ${shopkeeper_id} (type: ${typeof shopkeeper_id})`);

    let whereClause = "WHERE o.shopkeeper_id = ?";
    const params = [shopkeeper_id];

    if (status) {
      whereClause += " AND o.status = ?";
      params.push(status);
    }

    // Fetch orders first (without JSON aggregation for TiDB compatibility)
    const [orderRows] = await pool.query(
      `SELECT 
        o.id AS order_id,
        o.user_id,
        o.shopkeeper_id,
        o.status,
        o.total_amount,
        o.credits_used,
        o.created_at,
        o.credits_earned,
        o.latitude,
        o.longitude,
        o.delivery_address,
        u.name AS customer_name,
        u.phone AS customer_phone,
        u.email AS customer_email
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       ${whereClause}
       ORDER BY o.created_at DESC`,
      params
    );

    console.log(`Found ${orderRows.length} orders for shopkeeper ${shopkeeper_id}`);

    // Fetch order items for all orders
    if (orderRows.length > 0) {
      const orderIds = orderRows.map(o => o.order_id);
      const [itemRows] = await pool.query(
        `SELECT 
          oi.order_id,
          oi.product_id,
          COALESCE(p.name, 'Product Unavailable') AS product_name,
          p.image AS product_image,
          oi.quantity,
          oi.price
         FROM order_items oi
         LEFT JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id IN (?)`,
        [orderIds]
      );

      // Group items by order_id
      const itemsByOrder = {};
      for (const item of itemRows) {
        if (!itemsByOrder[item.order_id]) {
          itemsByOrder[item.order_id] = [];
        }
        itemsByOrder[item.order_id].push({
          product_id: item.product_id,
          product_name: item.product_name,
          product_image: item.product_image,
          quantity: item.quantity,
          price: item.price
        });
      }

      // Attach items to orders
      const orders = orderRows.map(order => ({
        ...order,
        items: itemsByOrder[order.order_id] || []
      }));

      return res.json({ success: true, orders });
    }

    res.json({ success: true, orders: [] });
  } catch (err) {
    console.error("Get shopkeeper orders error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Update order status (shopkeeper can update orders assigned to them)
shopkeeperRouter.patch("/orders/:orderId/status", verifyToken, verifyShopkeeperStatus, checkSubscriptionStatus, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    const { orderId } = req.params;
    const { status, cancellation_reason } = req.body;

    const orderIdNum = parseInt(orderId);
    if (isNaN(orderIdNum)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    // Validate status - use Completed instead of Delivered
    const validStatuses = ["Pending", "Processing", "Completed", "Cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid status. Must be one of: " + validStatuses.join(", ") 
      });
    }

    // Require cancellation reason if status is Cancelled
    if (status === "Cancelled" && !cancellation_reason) {
      return res.status(400).json({ 
        success: false, 
        message: "Cancellation reason is required when cancelling an order" 
      });
    }

    // Check if order belongs to this shopkeeper
    const [orderCheck] = await pool.query(
      "SELECT id FROM orders WHERE id = ? AND shopkeeper_id = ?",
      [orderIdNum, shopkeeper_id]
    );

    if (orderCheck.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Order not found or not assigned to you" 
      });
    }

    // Prepare update query and parameters
    const updateQuery = "UPDATE orders SET status = ? WHERE id = ?";
    const updateParams = [status, orderIdNum];

    // Handle stock restoration for cancelled orders
    if (status === "Cancelled") {
      console.log(`📦 Shopkeeper cancelling order ${orderIdNum} - using stock manager for restoration`);
      
      // Start transaction to ensure data consistency
      await pool.query("START TRANSACTION");
      
      try {
        // Update order status to Cancelled
        await pool.query(updateQuery, updateParams);
        
        // Restore stock using the stock manager utility
        const stockRestoration = await restoreStockForCancelledOrder(
          orderIdNum, 
          'shopkeeper', 
          cancellation_reason || 'Shopkeeper cancellation'
        );
        
        // Commit transaction
        await pool.query("COMMIT");
        
        if (stockRestoration.success) {
          console.log(`✅ Order ${orderIdNum} cancelled by shopkeeper and stock restored successfully`);
          console.log(`   - Items restored: ${stockRestoration.totalItemsRestored}`);
          console.log(`   - Total quantity restored: ${stockRestoration.totalQuantityRestored}`);
        } else {
          console.log(`⚠️ Order ${orderIdNum} cancelled but stock restoration had issues:`, stockRestoration.message);
        }
        
      } catch (transactionError) {
        // Rollback transaction on error
        await pool.query("ROLLBACK");
        console.error(`❌ Transaction failed for shopkeeper cancellation of order ${orderIdNum}:`, transactionError);
        throw transactionError;
      }
    } else {
      // For non-cancellation status updates, just update the order
      const [result] = await pool.query(updateQuery, updateParams);
      
      if (result.affectedRows === 0) {
        return res.status(400).json({ 
          success: false, 
          message: "Failed to update order status" 
        });
      }
    }

    // Award wellness points if order is completed
    // Note: For proper timer-based rewards, use verify-pickup endpoint instead
    if (status === "Completed") {
      try {
        const [[orderDetails]] = await pool.query(
          "SELECT user_id, created_at, timer_started_at, total_amount FROM orders WHERE id = ?",
          [orderIdNum]
        );
        
        if (orderDetails) {
          const pointsData = await awardWellnessPoints(
            pool, 
            orderDetails.user_id, 
            new Date(), // completion time (now)
            orderDetails.timer_started_at || orderDetails.created_at, // timer start or order creation time
            orderDetails.total_amount // ✅ NEW: Pass order amount for minimum check
          );
          
          console.log(`Awarded ${pointsData.points} wellness points to user ${orderDetails.user_id} for order ${orderIdNum}`);
        }
      } catch (pointsError) {
        console.error("Error awarding wellness points:", pointsError);
        // Don't fail the order update if points awarding fails
      }
    }

    // Broadcast via sockets: to shop room and to the specific customer room
    try {
      // fetch user_id for this order
      const [[orderRow]] = await pool.query("SELECT user_id FROM orders WHERE id = ?", [orderIdNum]);
      const customerId = orderRow?.user_id;
      
      console.log(`📡 Socket: Broadcasting order status update - orderId: ${orderIdNum}, status: ${status}`);
      console.log(`📡 Socket: customerId: ${customerId}, shopkeeper_id: ${shopkeeper_id}`);
      
      if (req.io) {
        const shopRoom = `shop_${shopkeeper_id}`;
        const customerRoom = `customer_${customerId}`;
        
        const socketPayload = { 
          orderId: orderIdNum, 
          status
        };
        
        console.log(`📡 Socket: Emitting to ${shopRoom}`);
        req.io.to(shopRoom).emit("orderStatusUpdate", socketPayload);
        
        if (customerId) {
          console.log(`📡 Socket: Emitting to ${customerRoom}`);
          req.io.to(customerRoom).emit("orderStatusUpdate", socketPayload);
        }
        
        console.log(`📡 Socket: Emissions completed successfully`);
      } else {
        console.error(`📡 Socket: req.io is not available!`);
      }

      // send push notification to customer
      if (customerId) {
        const [[cust]] = await pool.query(
          `SELECT u.id AS user_id, u.expo_push_token FROM users u WHERE u.id = ?`,
          [customerId]
        );
        const token = cust?.expo_push_token;
        if (token) {
          try {
            let pushTitle = "Order Update";
            let pushBody = `Your order #${orderIdNum} is now ${status}.`;
            
            if (status === "Cancelled" && cancellation_reason) {
              pushTitle = "Order Cancelled";
              pushBody = `Order #${orderIdNum} was cancelled by shopkeeper. Reason: ${cancellation_reason}. Stock has been restored.`;
            }
            
            const pushResult = await sendExpoPush(token, pushTitle, pushBody, { orderId: orderIdNum, status, cancellation_reason });
            if (pushResult?.invalidTokens?.length) {
              await pool.query("UPDATE users SET expo_push_token = NULL WHERE expo_push_token IN (?)", [pushResult.invalidTokens]);
              console.warn("Cleared invalid user tokens:", pushResult.invalidTokens);
            }
            if (pushResult?.nonExpoTokens?.length) {
              console.warn("Non-Expo tokens for user:", pushResult.nonExpoTokens);
            }
          } catch (pushErr) {
            console.error("Customer push error (shopkeeper route):", pushErr);
          }
        }
      }
    } catch (notifyErr) {
      console.error("Notification after status update failed:", notifyErr);
    }

    res.json({ 
      success: true, 
      message: `Order status updated to ${status}`,
      orderId: orderIdNum,
      status 
    });
  } catch (err) {
    console.error("Update order status error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * GET all products of the logged-in shopkeeper
 */
shopkeeperRouter.get("/products", verifyToken, verifyShopkeeperStatus, checkSubscriptionStatus, async (req, res) => {
  try {
    const shop_id = req.user.id;
    const [products] = await pool.query(
      "SELECT * FROM products WHERE shop_id = ? ORDER BY created_at DESC",
      [shop_id]
    );
    res.json({ success: true, products });
  } catch (err) {
    console.error("Get products error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * ADD new product
 */
shopkeeperRouter.post("/products", verifyToken, verifyShopkeeperStatus, checkSubscriptionStatus, upload.single("image"), async (req, res) => {
  try {
    const shop_id = req.user.id;
    const { name, description, category, price, stock } = req.body;

    if (!name || price == null || stock == null) {
      return res.status(400).json({ success: false, message: "Name, price, and stock are required" });
    }

    const parsedPrice = Number(price);
    const parsedStock = Number(stock);
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) return res.status(400).json({ success: false, message: "Invalid price" });
    if (Number.isNaN(parsedStock) || parsedStock < 0) return res.status(400).json({ success: false, message: "Invalid stock" });

    // ✅ FIX: Ensure price is stored with exactly 2 decimal places
    const formattedPrice = parseFloat(parsedPrice.toFixed(2));

    // Handle optional image upload
    let imageUrl = null;
    if (req.file) {
      try {
        const streamifier = await import('streamifier');
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream({ folder: "products" }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
          });
          streamifier.default.createReadStream(req.file.buffer).pipe(stream);
        });
        imageUrl = result.secure_url;
      } catch (uploadErr) {
        console.error("Product image upload error:", uploadErr);
        return res.status(500).json({ success: false, message: "Failed to upload image" });
      }
    }

    const [result] = await pool.query(
      `INSERT INTO products (shop_id, name, description, category, price, stock, image) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [shop_id, name.trim(), description || null, category || null, formattedPrice, parsedStock, imageUrl]
    );

    const [created] = await pool.query("SELECT * FROM products WHERE id = ?", [result.insertId]);

    res.status(201).json({ success: true, id: result.insertId, product: created[0], message: "Product added successfully" });
  } catch (err) {
    console.error("Add product error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * UPDATE product
 */
shopkeeperRouter.put("/products/:id", verifyToken, verifyShopkeeperStatus, checkSubscriptionStatus, upload.single("image"), async (req, res) => {
  try {
    const shop_id = req.user.id;
    const productId = req.params.id;
    const { name, description, category, price, stock } = req.body;

    const [existing] = await pool.query("SELECT * FROM products WHERE id = ? AND shop_id = ?", [productId, shop_id]);
    if (existing.length === 0) return res.status(404).json({ success: false, message: "Product not found" });

    // Handle optional image upload
    let imageUrl = existing[0].image;
    if (req.file) {
      try {
        const streamifier = await import('streamifier');
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream({ folder: "products" }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
          });
          streamifier.default.createReadStream(req.file.buffer).pipe(stream);
        });
        imageUrl = result.secure_url;
      } catch (uploadErr) {
        console.error("Product image upload error:", uploadErr);
        return res.status(500).json({ success: false, message: "Failed to upload image" });
      }
    }

    const fields = [];
    const values = [];
    if (name) { fields.push("name = ?"); values.push(name.trim()); }
    if (description !== undefined) { fields.push("description = ?"); values.push(description || null); }
    if (category) { fields.push("category = ?"); values.push(category); }
    if (price != null) { 
      const p = Number(price); 
      if (Number.isNaN(p) || p < 0) return res.status(400).json({ success: false, message: "Invalid price" }); 
      // ✅ FIX: Ensure price is stored with exactly 2 decimal places
      const formattedPrice = parseFloat(p.toFixed(2));
      fields.push("price = ?"); 
      values.push(formattedPrice); 
    }
    if (stock != null) { const s = Number(stock); if (Number.isNaN(s) || s < 0) return res.status(400).json({ success: false, message: "Invalid stock" }); fields.push("stock = ?"); values.push(s); }
    if (imageUrl !== existing[0].image) { fields.push("image = ?"); values.push(imageUrl); }

    if (fields.length === 0) return res.status(400).json({ success: false, message: "No fields to update" });

    values.push(productId, shop_id);
    await pool.query(`UPDATE products SET ${fields.join(", ")} WHERE id = ? AND shop_id = ?`, values);

    const [updated] = await pool.query("SELECT * FROM products WHERE id = ? AND shop_id = ?", [productId, shop_id]);
    res.json({ success: true, message: "Product updated successfully", product: updated[0] });
  } catch (err) {
    console.error("Update product error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * DELETE product
 */
shopkeeperRouter.delete("/products/:id", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    const shop_id = req.user.id;
    const productId = req.params.id;

    const [existing] = await pool.query("SELECT * FROM products WHERE id = ? AND shop_id = ?", [productId, shop_id]);
    if (existing.length === 0) return res.status(404).json({ success: false, message: "Product not found" });

    // Check if product is referenced in any order_items
    const [usedInOrders] = await pool.query(
      `SELECT COUNT(*) AS c FROM order_items WHERE product_id = ?`,
      [productId]
    );
    if (usedInOrders[0].c > 0) return res.status(400).json({ success: false, message: "Cannot delete product involved in orders" });

    await pool.query("DELETE FROM products WHERE id = ? AND shop_id = ?", [productId, shop_id]);
    res.json({ success: true, message: "Product deleted successfully" });
  } catch (err) {
    console.error("Delete product error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// --- Access global products (shopkeeper) ---
// List all global products (read-only for shopkeepers) filtered by shop scale
shopkeeperRouter.get("/global-products", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    // Get shopkeeper's scale
    const [shopkeeper] = await pool.query(
      "SELECT shop_scale FROM shopkeepers WHERE id = ?",
      [req.user.id]
    );
    
    if (shopkeeper.length === 0) {
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
    }
    
    const shopScale = shopkeeper[0].shop_scale || 'small';
    
    // Get products available for this shop scale
    const [rows] = await pool.query(`
      SELECT 
        id, 
        name, 
        price,
        category, 
        description, 
        image, 
        brand,
        barcode,
        shop_scales,
        created_at 
      FROM global_products 
      WHERE JSON_CONTAINS(shop_scales, '"all"') 
         OR JSON_CONTAINS(shop_scales, ?)
      ORDER BY created_at DESC
    `, [JSON.stringify(shopScale)]);
    
    // Parse shop_scales for response
    const products = rows.map(product => {
      let shopScales = ['all'];
      if (product.shop_scales) {
        try {
          shopScales = JSON.parse(product.shop_scales);
        } catch (e) {
          console.warn('Failed to parse shop_scales for product', product.id, ':', e.message);
          shopScales = ['all'];
        }
      }
      return {
        ...product,
        shopScales: shopScales
      };
    });
    
    res.json({ 
      success: true, 
      products: products,
      shopScale: shopScale
    });
  } catch (err) {
    console.error("Get global products error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Add a product into shopkeeper's catalog from global_products
// body: { global_product_id, price (optional override), stock (required) }
shopkeeperRouter.post("/products/from-global", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    const shop_id = req.user.id;
    const { global_product_id, price, stock } = req.body;

    if (!global_product_id) {
      return res.status(400).json({ success: false, message: "global_product_id is required" });
    }
    if (stock === undefined || stock === null) {
      return res.status(400).json({ success: false, message: "stock is required" });
    }
    const parsedStock = Number(stock);
    if (Number.isNaN(parsedStock) || parsedStock < 0) {
      return res.status(400).json({ success: false, message: "Invalid stock" });
    }

    // Verify global product exists
    const [gpRows] = await pool.query("SELECT * FROM global_products WHERE id = ?", [global_product_id]);
    if (gpRows.length === 0) {
      return res.status(404).json({ success: false, message: "Global product not found" });
    }
    const gp = gpRows[0];

    // Prevent duplicate addition for same shop
    const [exists] = await pool.query(
      "SELECT id FROM products WHERE shop_id = ? AND global_product_id = ?",
      [shop_id, global_product_id]
    );
    if (exists.length > 0) {
      return res.status(400).json({ success: false, message: "Product already added to your catalog" });
    }

    const priceToUse = price != null ? Number(price) : gp.price;
    if (Number.isNaN(priceToUse) || priceToUse < 0) {
      return res.status(400).json({ success: false, message: "Invalid price" });
    }

    const [result] = await pool.query(
      `INSERT INTO products (shop_id, global_product_id, name, description, category, price, stock, image)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [shop_id, global_product_id, gp.name, gp.description || null, gp.category || null, priceToUse, parsedStock, gp.image || null]
    );

    const [created] = await pool.query("SELECT * FROM products WHERE id = ?", [result.insertId]);
    res.status(201).json({ success: true, id: result.insertId, product: created[0], message: "Product added from global catalog" });
  } catch (err) {
    console.error("Add from global error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Update only stock for a shopkeeper's product
shopkeeperRouter.patch("/products/:id/stock", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    const shop_id = req.user.id;
    const productId = req.params.id;
    const { stock } = req.body;

    if (stock == null) {
      return res.status(400).json({ success: false, message: "stock is required" });
    }
    const parsedStock = Number(stock);
    if (Number.isNaN(parsedStock) || parsedStock < 0) {
      return res.status(400).json({ success: false, message: "Invalid stock value" });
    }

    const [existing] = await pool.query("SELECT id FROM products WHERE id = ? AND shop_id = ?", [productId, shop_id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    await pool.query("UPDATE products SET stock = ? WHERE id = ? AND shop_id = ?", [parsedStock, productId, shop_id]);
    const [updated] = await pool.query("SELECT * FROM products WHERE id = ? AND shop_id = ?", [productId, shop_id]);

    res.json({ success: true, message: "Stock updated", product: updated[0] });
  } catch (err) {
    console.error("Update stock error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Save expo push token for authenticated shopkeeper
shopkeeperRouter.post("/push-token", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: "token is required" });

    await pool.query("UPDATE shopkeepers SET expo_push_token = ? WHERE id = ?", [token, req.user.id]);
    return res.json({ success: true, message: "Push token saved" });
  } catch (err) {
    console.error("Save shopkeeper push token error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// BILLING/SUBSCRIPTION ENDPOINTS - Shopkeeper pays admin for order access

// Get billing summary (amount due to admin)
shopkeeperRouter.get("/earnings", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;

    // Get shopkeeper subscription info
    const [shopkeeper] = await pool.query(
      `SELECT shop_scale, subscription_status, trial_ends_at, next_payment_due 
       FROM shopkeepers WHERE id = ?`,
      [shopkeeper_id]
    );

    // Get total payments made by this shopkeeper
    const [payments] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total_paid 
       FROM billing_payments 
       WHERE shopkeeper_id = ? AND status = 'approved'`,
      [shopkeeper_id]
    ).catch(() => [[{ total_paid: 0 }]]);

    // Get pending payments
    const [pendingPayments] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as pending_amount 
       FROM billing_payments 
       WHERE shopkeeper_id = ? AND status = 'pending'`,
      [shopkeeper_id]
    ).catch(() => [[{ pending_amount: 0 }]]);

    // Get order stats
    const [orderStats] = await pool.query(
      `SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status = 'Delivered' THEN 1 END) as delivered_orders,
        COALESCE(SUM(CASE WHEN status = 'Delivered' THEN total_amount END), 0) as total_sales
       FROM orders 
       WHERE shopkeeper_id = ?`,
      [shopkeeper_id]
    );

    const shopData = shopkeeper[0] || {};
    
    res.json({
      success: true,
      data: {
        total_paid: payments[0]?.total_paid || 0,
        pending_amount: pendingPayments[0]?.pending_amount || 0,
        subscription_status: shopData.subscription_status || 'trial',
        shop_scale: shopData.shop_scale || 'small',
        trial_ends_at: shopData.trial_ends_at,
        next_payment_due: shopData.next_payment_due,
        total_orders: orderStats[0].total_orders,
        delivered_orders: orderStats[0].delivered_orders,
        total_sales: orderStats[0].total_sales
      }
    });

  } catch (err) {
    console.error("Get billing summary error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get payment history (payments made to admin)
shopkeeperRouter.get("/earnings/history", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;

    // Get payment history from billing_payments table
    const [payments] = await pool.query(
      `SELECT 
        id,
        amount,
        payment_method,
        transaction_id,
        status,
        notes,
        payment_date as created_at
       FROM billing_payments 
       WHERE shopkeeper_id = ?
       ORDER BY payment_date DESC
       LIMIT 50`,
      [shopkeeper_id]
    ).catch(() => [[]]);

    res.json({
      success: true,
      data: payments
    });

  } catch (err) {
    console.error("Get payment history error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get billing/subscription status
shopkeeperRouter.get("/earnings/status", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;

    // Get shopkeeper subscription details
    const [shopkeeper] = await pool.query(
      `SELECT shop_scale, subscription_status, trial_ends_at, next_payment_due, last_payment_date
       FROM shopkeepers WHERE id = ?`,
      [shopkeeper_id]
    );

    if (shopkeeper.length === 0) {
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
    }

    const data = shopkeeper[0];
    const now = new Date();
    
    // Calculate days remaining in trial
    let daysRemaining = 0;
    if (data.trial_ends_at) {
      const trialEnds = new Date(data.trial_ends_at);
      if (trialEnds > now) {
        daysRemaining = Math.ceil((trialEnds - now) / (1000 * 60 * 60 * 24));
      }
    }

    // Get this month's payment total
    const [monthPayments] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as paid_this_month
       FROM billing_payments 
       WHERE shopkeeper_id = ? 
       AND status = 'approved'
       AND MONTH(payment_date) = MONTH(CURRENT_DATE())
       AND YEAR(payment_date) = YEAR(CURRENT_DATE())`,
      [shopkeeper_id]
    ).catch(() => [[{ paid_this_month: 0 }]]);

    res.json({
      success: true,
      data: {
        subscription_status: data.subscription_status || 'trial',
        shop_scale: data.shop_scale || 'small',
        trial_ends_at: data.trial_ends_at,
        days_remaining: daysRemaining,
        is_trial_active: data.subscription_status === 'trial' && daysRemaining > 0,
        next_payment_due: data.next_payment_due,
        last_payment_date: data.last_payment_date,
        paid_this_month: monthPayments[0]?.paid_this_month || 0
      }
    });

  } catch (err) {
    console.error("Get billing status error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Update shop scale and auto-add matching global products
shopkeeperRouter.put("/update-scale/:id", verifyToken, async (req, res) => {
  try {
    const shopkeeperId = req.params.id;
    const { shop_scale } = req.body;
    
    if (!['small', 'medium', 'large'].includes(shop_scale)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid shop scale. Must be small, medium, or large" 
      });
    }
    
    // Set trial period for new scale selection
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 90);
    
    const [result] = await pool.query(
      "UPDATE shopkeepers SET shop_scale = ?, trial_ends_at = ?, subscription_status = 'trial' WHERE id = ?",
      [shop_scale, trialEndDate, shopkeeperId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
    }
    
    // Auto-add global products matching this scale to shopkeeper's products
    let productsAdded = 0;
    try {
      // Get global products available for this scale (matching scale or "all")
      const [globalProducts] = await pool.query(`
        SELECT id, name, description, category, price, image
        FROM global_products 
        WHERE JSON_CONTAINS(shop_scales, '"all"') 
           OR JSON_CONTAINS(shop_scales, ?)
      `, [JSON.stringify(shop_scale)]);
      
      // Get existing products for this shopkeeper to avoid duplicates
      const [existingProducts] = await pool.query(
        "SELECT global_product_id FROM products WHERE shop_id = ? AND global_product_id IS NOT NULL",
        [shopkeeperId]
      );
      const existingGlobalIds = new Set(existingProducts.map(p => p.global_product_id));
      
      // Add products that don't already exist
      for (const gp of globalProducts) {
        if (!existingGlobalIds.has(gp.id)) {
          await pool.query(
            `INSERT INTO products (shop_id, global_product_id, name, description, category, price, stock, image)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [shopkeeperId, gp.id, gp.name, gp.description || null, gp.category || null, gp.price || 0, 0, gp.image || null]
          );
          productsAdded++;
        }
      }
      
      console.log(`Auto-added ${productsAdded} products for shopkeeper ${shopkeeperId} with scale ${shop_scale}`);
    } catch (productErr) {
      console.error("Error auto-adding products:", productErr);
      // Don't fail the whole request if product addition fails
    }
    
    res.json({ 
      success: true, 
      message: `Shop scale updated to ${shop_scale}`,
      trial_ends_at: trialEndDate,
      products_added: productsAdded
    });
  } catch (err) {
    console.error("Update shop scale error:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Get subscription status
shopkeeperRouter.get("/subscription-status", verifyToken, async (req, res) => {
  try {
    const [shopkeeper] = await pool.query(
      "SELECT shop_scale, trial_ends_at, subscription_status, last_payment_date, next_payment_due FROM shopkeepers WHERE id = ?",
      [req.user.id]
    );
    
    if (shopkeeper.length === 0) {
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
    }
    
    const data = shopkeeper[0];
    const now = new Date();
    const trialEndsAt = new Date(data.trial_ends_at);
    
    // Calculate days remaining
    let daysRemaining = 0;
    let status = data.subscription_status;
    
    if (status === 'trial' && trialEndsAt > now) {
      daysRemaining = Math.ceil((trialEndsAt - now) / (1000 * 60 * 60 * 24));
    } else if (status === 'trial' && trialEndsAt <= now) {
      // Trial expired, update status
      status = 'overdue';
      const nextPaymentDue = new Date(trialEndsAt);
      nextPaymentDue.setDate(nextPaymentDue.getDate() + 17); // 15 + 2 grace days
      
      await pool.query(
        "UPDATE shopkeepers SET subscription_status = 'overdue', next_payment_due = ? WHERE id = ?",
        [nextPaymentDue, req.user.id]
      );
    }
    
    res.json({ 
      success: true, 
      data: {
        ...data,
        subscription_status: status,
        days_remaining: daysRemaining,
        is_trial_active: status === 'trial' && daysRemaining > 0
      }
    });
  } catch (err) {
    console.error("Get subscription status error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Submit payment - Check trial period first
shopkeeperRouter.post("/submit-payment", verifyToken, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    const { amount, payment_method, transaction_id } = req.body;

    // Get shopkeeper details
    const [[shopkeeper]] = await pool.query(
      "SELECT trial_start_date, created_at FROM shopkeepers WHERE id = ?",
      [shopkeeper_id]
    );

    if (!shopkeeper) {
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
    }

    // Check if still in 90-day trial period
    const trialStart = new Date(shopkeeper.trial_start_date || shopkeeper.created_at);
    const trialEnd = new Date(trialStart);
    trialEnd.setDate(trialEnd.getDate() + 90); // 90-day trial
    const now = new Date();

    if (now < trialEnd) {
      const daysRemaining = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
      return res.status(400).json({ 
        success: false, 
        message: `You are currently in your 90-day FREE trial period with ${daysRemaining} days remaining. No payment is required during trial. ⚠️ If you accidentally send any payment during trial, it will be refunded.`,
        trial_active: true,
        days_remaining: daysRemaining
      });
    }

    // Trial ended - allow payment submission
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Valid amount is required" });
    }

    // Insert payment request
    const [result] = await pool.query(
      `INSERT INTO billing_payments (shopkeeper_id, amount, payment_method, transaction_id, status) 
       VALUES (?, ?, ?, ?, 'pending')`,
      [shopkeeper_id, amount, payment_method || 'upi', transaction_id || null]
    );

    res.json({ 
      success: true, 
      message: "Payment submitted successfully. Waiting for admin approval.",
      payment_id: result.insertId
    });
  } catch (err) {
    console.error("Submit payment error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get payment history
shopkeeperRouter.get("/payment-history", verifyToken, async (req, res) => {
  try {
    const [payments] = await pool.query(
      "SELECT * FROM billing_payments WHERE shopkeeper_id = ? ORDER BY payment_date DESC",
      [req.user.id]
    );
    
    res.json({ success: true, data: payments });
  } catch (err) {
    console.error("Get payment history error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ==================== ORDER TIMER SYSTEM ====================

// Helper function to check if timer tables exist
const checkTimerTablesExist = async () => {
  try {
    const [tables] = await pool.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME IN ('order_timers')
    `);
    return tables.length > 0;
  } catch (error) {
    return false;
  }
};

// Start timer for an order (when order is ready for pickup)
shopkeeperRouter.post("/orders/:orderId/start-timer", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    const { orderId } = req.params;
    const { timer_duration = 420 } = req.body; // Default 7 minutes

    const orderIdNum = parseInt(orderId);
    if (isNaN(orderIdNum)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    // Check if timer tables exist
    const timerTablesExist = await checkTimerTablesExist();
    if (!timerTablesExist) {
      return res.status(503).json({ 
        success: false, 
        message: "Timer system not initialized. Please run: npm run init-timer-safe" 
      });
    }

    // Check if order belongs to this shopkeeper and is in correct status
    const [orderCheck] = await pool.query(
      "SELECT id, status FROM orders WHERE id = ? AND shopkeeper_id = ?",
      [orderIdNum, shopkeeper_id]
    );

    if (orderCheck.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Order not found or not assigned to you" 
      });
    }

    if (orderCheck[0].status !== 'Pending') {
      return res.status(400).json({ 
        success: false, 
        message: "Timer can only be started for pending orders" 
      });
    }

    // Generate 6-digit pickup code
    const pickupCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Calculate timer expiry
    const timerStarted = new Date();
    const timerExpires = new Date(timerStarted.getTime() + (timer_duration * 1000));

    // Create or update timer record
    try {
      await pool.query(`
        INSERT INTO order_timers (order_id, pickup_code, timer_duration, timer_started_at, timer_expires_at, is_active)
        VALUES (?, ?, ?, ?, ?, TRUE)
        ON DUPLICATE KEY UPDATE
          pickup_code = VALUES(pickup_code),
          timer_duration = VALUES(timer_duration),
          timer_started_at = VALUES(timer_started_at),
          timer_expires_at = VALUES(timer_expires_at),
          is_active = TRUE,
          is_expired = FALSE,
          stopped_at = NULL
      `, [orderIdNum, pickupCode, timer_duration, timerStarted, timerExpires]);
    } catch (timerError) {
      console.error("Timer record creation failed:", timerError);
      // Continue without timer record if table doesn't exist
    }

    // Update orders table
    await pool.query(`
      UPDATE orders 
      SET has_timer = TRUE, pickup_code = ?, timer_started_at = ?, timer_expires_at = ?
      WHERE id = ?
    `, [pickupCode, timerStarted, timerExpires, orderIdNum]);

    // Broadcast timer started event
    if (req.io) {
      req.io.to(`shop_${shopkeeper_id}`).emit("timerStarted", { 
        orderId: orderIdNum, 
        pickupCode, 
        timerDuration: timer_duration,
        expiresAt: timerExpires
      });
    }

    res.json({ 
      success: true, 
      message: "Timer started successfully",
      pickup_code: pickupCode,
      timer_duration: timer_duration,
      expires_at: timerExpires
    });

  } catch (err) {
    console.error("Start timer error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Verify pickup code - stops timer and marks order as Completed
// This is called when customer arrives at shop and gives the code to shopkeeper
shopkeeperRouter.post("/orders/:orderId/verify-pickup", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    const { orderId } = req.params;
    const { pickup_code } = req.body;

    console.log(`Verify pickup: shopkeeper=${shopkeeper_id}, order=${orderId}, code=${pickup_code}`);

    const orderIdNum = parseInt(orderId);
    if (isNaN(orderIdNum)) {
      console.error("Invalid order ID:", orderId);
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    if (!pickup_code) {
      console.error("Pickup code missing");
      return res.status(400).json({ success: false, message: "Pickup code is required" });
    }

    // Get order info (without timer table join to avoid errors if table doesn't exist)
    let orderInfo;
    try {
      [orderInfo] = await pool.query(`
        SELECT o.id, o.status, o.pickup_code, o.user_id, o.created_at, o.timer_started_at, o.timer_expires_at, o.total_amount
        FROM orders o
        WHERE o.id = ? AND o.shopkeeper_id = ?
      `, [orderIdNum, shopkeeper_id]);
    } catch (queryError) {
      console.error("Order query error:", queryError);
      return res.status(500).json({ success: false, message: "Database error: " + queryError.message });
    }

    if (orderInfo.length === 0) {
      console.error(`Order ${orderIdNum} not found for shopkeeper ${shopkeeper_id}`);
      return res.status(404).json({ 
        success: false, 
        message: "Order not found or not assigned to you" 
      });
    }

    const order = orderInfo[0];
    console.log(`Order found: status=${order.status}, pickup_code=${order.pickup_code}`);

    // Check if order is already completed
    if (order.status === 'Completed') {
      console.warn(`Order ${orderIdNum} already completed`);
      return res.status(400).json({ 
        success: false, 
        message: "Order is already completed" 
      });
    }

    // Verify pickup code
    if (order.pickup_code !== pickup_code) {
      console.error(`Invalid pickup code: expected=${order.pickup_code}, got=${pickup_code}`);
      return res.status(400).json({ 
        success: false, 
        message: "Invalid pickup code. Please check and try again." 
      });
    }

    const now = new Date();
    const timerExpiresAt = order.timer_expires_at;
    // Check if customer arrived on time
    const wasOnTime = timerExpiresAt && now <= new Date(timerExpiresAt);
    console.log(`Timer check: expires=${timerExpiresAt}, now=${now}, wasOnTime=${wasOnTime}`);

    // Stop timer in order_timers table (if it exists)
    try {
      await pool.query(`
        UPDATE order_timers 
        SET is_active = FALSE, stopped_at = ?, is_expired = ?
        WHERE order_id = ?
      `, [now, !wasOnTime, orderIdNum]);
      console.log("Timer record updated successfully");
    } catch (timerError) {
      console.warn("Timer update failed (table may not exist):", timerError.message);
      // Continue - this is not critical
    }

    // Mark order as Completed
    try {
      await pool.query(`
        UPDATE orders 
        SET status = 'Completed', has_timer = FALSE
        WHERE id = ?
      `, [orderIdNum]);
      console.log(`Order ${orderIdNum} marked as Completed`);
    } catch (updateError) {
      console.error("Order update error:", updateError);
      return res.status(500).json({ success: false, message: "Failed to update order: " + updateError.message });
    }

    // Award wellness points based on timing
    let pointsAwarded = 0;
    try {
      const pointsData = await awardWellnessPoints(
        pool, 
        order.user_id, 
        now, // completion time
        order.timer_started_at || order.created_at, // timer start time
        order.total_amount // ✅ NEW: Pass order amount for minimum check
      );
      pointsAwarded = pointsData.points;
      console.log(`Awarded ${pointsAwarded} wellness points to user ${order.user_id} for order ${orderIdNum}`);
    } catch (pointsError) {
      console.error("Error awarding wellness points:", pointsError);
      // Continue - points are not critical
    }

    // Broadcast events via socket
    if (req.io) {
      // Convert to numbers to ensure consistent room names
      const shopRoom = `shop_${Number(shopkeeper_id)}`;
      const customerRoom = `customer_${Number(order.user_id)}`;
      
      console.log(`Socket: Emitting orderStatusUpdate to ${shopRoom} and ${customerRoom}`);
      console.log(`Socket: Order data - orderId=${orderIdNum}, status=Completed, wasOnTime=${wasOnTime}, points=${pointsAwarded}`);
      
      const socketPayload = { 
        orderId: orderIdNum, 
        status: 'Completed',
        wasOnTime,
        timerStopped: true,
        stoppedAt: now.toISOString(),
        pointsAwarded
      };
      
      req.io.to(shopRoom).emit("orderStatusUpdate", socketPayload);
      req.io.to(customerRoom).emit("orderStatusUpdate", socketPayload);
      
      // Also emit a specific timer stopped event
      req.io.to(shopRoom).emit("timerStopped", { 
        orderId: orderIdNum, 
        stoppedAt: now.toISOString(),
        wasOnTime,
        pointsAwarded
      });
      req.io.to(customerRoom).emit("timerStopped", { 
        orderId: orderIdNum, 
        stoppedAt: now.toISOString(),
        wasOnTime,
        pointsAwarded
      });
      
      console.log(`Socket: Events emitted successfully to ${shopRoom} and ${customerRoom}`);
    } else {
      console.warn("Socket: req.io is not available!");
    }

    // Send push notification to customer
    try {
      const [[customer]] = await pool.query(
        `SELECT expo_push_token FROM users WHERE id = ?`,
        [order.user_id]
      );
      
      if (customer?.expo_push_token) {
        const message = wasOnTime 
          ? `🎉 Order completed on time! You earned ${pointsAwarded} Store credits.`
          : `📦 Order completed! You earned ${pointsAwarded} Store credits (reduced due to late arrival).`;
          
        const token = customer.expo_push_token;
        if (isFCMToken(token)) {
          await sendFCMPush(token, "Order Completed!", message, { orderId: String(orderIdNum), status: 'Completed', wasOnTime: String(wasOnTime) });
        } else {
          await sendExpoPush(token, "Order Completed!", message, { orderId: orderIdNum, status: 'Completed', wasOnTime });
        }
      }
    } catch (pushError) {
      console.error("Push notification error:", pushError);
      // Continue - push is not critical
    }

    console.log(`Verify pickup successful for order ${orderIdNum}`);
    res.json({ 
      success: true, 
      message: wasOnTime 
        ? `Order completed on time! Customer earned ${pointsAwarded} Store credits.`
        : `Order completed! Customer earned ${pointsAwarded} Store credits (late arrival).`,
      was_on_time: wasOnTime,
      points_awarded: pointsAwarded
    });

  } catch (err) {
    console.error("=== VERIFY PICKUP ERROR ===");
    console.error("Error message:", err.message);
    console.error("Error stack:", err.stack);
    console.error("Error name:", err.name);
    console.error("Full error:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
    console.error("=========================");
    res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

// Legacy endpoint - redirects to verify-pickup
shopkeeperRouter.post("/orders/:orderId/stop-timer", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  // Forward to verify-pickup endpoint
  req.url = req.url.replace('stop-timer', 'verify-pickup');
  return shopkeeperRouter.handle(req, res);
});

// Get timer status for an order
shopkeeperRouter.get("/orders/:orderId/timer", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    const { orderId } = req.params;

    const orderIdNum = parseInt(orderId);
    if (isNaN(orderIdNum)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    // Get timer info
    const [timerInfo] = await pool.query(`
      SELECT o.id, o.pickup_code, o.has_timer, o.timer_started_at, o.timer_expires_at,
             ot.timer_duration, ot.is_active, ot.is_expired, ot.stopped_at
      FROM orders o
      LEFT JOIN order_timers ot ON o.id = ot.order_id
      WHERE o.id = ? AND o.shopkeeper_id = ?
    `, [orderIdNum, shopkeeper_id]);

    if (timerInfo.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Order not found or not assigned to you" 
      });
    }

    const timer = timerInfo[0];
    let timeLeft = 0;

    if (timer.is_active && timer.timer_expires_at) {
      const now = new Date();
      const expiresAt = new Date(timer.timer_expires_at);
      timeLeft = Math.max(0, Math.floor((expiresAt - now) / 1000));
      
      // Auto-expire if time is up
      if (timeLeft === 0 && timer.is_active) {
        await pool.query(`
          UPDATE order_timers 
          SET is_active = FALSE, is_expired = TRUE
          WHERE order_id = ?
        `, [orderIdNum]);
        
        timer.is_active = false;
        timer.is_expired = true;
      }
    }

    res.json({ 
      success: true, 
      timer: {
        has_timer: timer.has_timer,
        pickup_code: timer.pickup_code,
        is_active: timer.is_active,
        is_expired: timer.is_expired,
        time_left: timeLeft,
        timer_duration: timer.timer_duration,
        started_at: timer.timer_started_at,
        expires_at: timer.timer_expires_at,
        stopped_at: timer.stopped_at
      }
    });

  } catch (err) {
    console.error("Get timer error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Cleanup expired timers (can be called periodically)
shopkeeperRouter.post("/cleanup-expired-timers", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    const now = new Date();
    
    // Find and expire active timers that have passed their expiry time
    const [expiredTimers] = await pool.query(`
      SELECT ot.order_id 
      FROM order_timers ot
      WHERE ot.is_active = TRUE AND ot.timer_expires_at < ?
    `, [now]);

    if (expiredTimers.length > 0) {
      const orderIds = expiredTimers.map(t => t.order_id);
      
      // Mark timers as expired
      await pool.query(`
        UPDATE order_timers 
        SET is_active = FALSE, is_expired = TRUE
        WHERE order_id IN (${orderIds.map(() => '?').join(',')})
      `, orderIds);

      // Update orders table
      await pool.query(`
        UPDATE orders 
        SET has_timer = FALSE
        WHERE id IN (${orderIds.map(() => '?').join(',')})
      `, orderIds);

      console.log(`Expired ${expiredTimers.length} timers`);
    }

    res.json({ 
      success: true, 
      message: `Cleaned up ${expiredTimers.length} expired timers`
    });

  } catch (err) {
    console.error("Cleanup timers error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ==================== LOCATION VERIFICATION SYSTEM ====================

// Verify shopkeeper location
shopkeeperRouter.post("/verify-location", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    const { latitude, longitude, accuracy } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ 
        success: false, 
        message: "Latitude and longitude are required" 
      });
    }

    // Get shopkeeper's registered location
    const [shopkeeper] = await pool.query(
      "SELECT latitude, longitude, address FROM shopkeepers WHERE id = ?",
      [shopkeeper_id]
    );

    if (shopkeeper.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Shopkeeper not found" 
      });
    }

    const registeredLat = shopkeeper[0].latitude;
    const registeredLon = shopkeeper[0].longitude;

    if (!registeredLat || !registeredLon) {
      // First time location setup
      return res.json({
        success: true,
        verified: false,
        isFirstTime: true,
        message: "Location not registered. Please register your shop location."
      });
    }

    // Calculate distance using Haversine formula
    const R = 6371e3; // Earth's radius in meters
    const φ1 = registeredLat * Math.PI / 180;
    const φ2 = latitude * Math.PI / 180;
    const Δφ = (latitude - registeredLat) * Math.PI / 180;
    const Δλ = (longitude - registeredLon) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c; // Distance in meters

    const tolerance = 50; // 50 meters tolerance
    const verified = distance <= tolerance;

    // Log location verification attempt
    await pool.query(`
      INSERT INTO location_verifications (shopkeeper_id, latitude, longitude, distance, verified, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `, [shopkeeper_id, latitude, longitude, Math.round(distance), verified]);

    res.json({
      success: true,
      verified: verified,
      distance: Math.round(distance),
      tolerance: tolerance,
      message: verified 
        ? "Location verified successfully"
        : `You are ${Math.round(distance)}m away from your registered location`
    });

  } catch (err) {
    console.error("Location verification error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get location verification history
shopkeeperRouter.get("/location-history", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    
    const [history] = await pool.query(`
      SELECT latitude, longitude, distance, verified, created_at
      FROM location_verifications
      WHERE shopkeeper_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `, [shopkeeper_id]);

    res.json({
      success: true,
      history: history
    });

  } catch (err) {
    console.error("Location history error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /api/shopkeeper/payment-info - Get admin payment credentials for payment requests
shopkeeperRouter.get("/payment-info", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    // Get admin payment information for shopkeepers to see where to send payments
    const [rows] = await pool.query(
      "SELECT upi_id, bank_account, bank_name, ifsc_code, account_holder, qr_code FROM payment_info WHERE type = 'admin' LIMIT 1"
    ).catch(() => [[]]);
    
    if (rows.length === 0) {
      // Return default structure if no payment info is set
      return res.json({
        success: true,
        data: {
          upi_id: '',
          bank_account: '',
          bank_name: '',
          ifsc_code: '',
          account_holder: 'NexKirana Admin',
          qr_code: null
        }
      });
    }

    res.json({ 
      success: true, 
      data: rows[0] 
    });
  } catch (err) {
    console.error('Shopkeeper payment info fetch error:', err);
    res.status(500).json({ 
      success: false, 
      message: "Server error", 
      error: err.message 
    });
  }
});

// GET /api/shopkeeper/subscription - Get detailed subscription status
shopkeeperRouter.get("/subscription", verifyToken, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    const statusInfo = await calculateSubscriptionStatus(shopkeeper_id);
    
    res.json({ 
      success: true, 
      subscription: statusInfo
    });
  } catch (err) {
    console.error('Subscription status error:', err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to get subscription status", 
      error: err.message 
    });
  }
});

// POST /api/shopkeeper/subscription/check-access - Check if shopkeeper can access app
shopkeeperRouter.post("/subscription/check-access", verifyToken, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    const canAccess = await canAccessApp(shopkeeper_id);
    const statusInfo = await calculateSubscriptionStatus(shopkeeper_id);
    
    res.json({ 
      success: true, 
      canAccess,
      subscription: statusInfo
    });
  } catch (err) {
    console.error('Subscription access check error:', err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to check access", 
      error: err.message 
    });
  }
});

export default shopkeeperRouter;