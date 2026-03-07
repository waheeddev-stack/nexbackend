import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import { sendExpoPush } from "../utils/expoPush.js";
import { sendFCMPush, isFCMToken } from "../utils/fcmPush.js";
import dotenv from "dotenv";
import upload from "../config/upload.js";
import cloudinary from "../config/cloudinary.js";
import  verifyToken  from "../middleware/auth.js";
import { deductWellnessPoints, validatePointsUsage } from "../utils/wellnessPoints.js";
import { createJWEToken } from "../utils/jweToken.js";
import { restoreStockForCancelledOrder } from "../utils/stockManager.js";

dotenv.config();

const userrouter = express.Router();

// Find nearby shopkeepers and show their products
userrouter.get("/nearby-shops", async (req, res) => {
  try {
    const { latitude, longitude, radiusKm = 1.25 } = req.query;
    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, message: "Missing location" });
    }

    console.log(`🔍 Nearby shops request: lat=${latitude}, lng=${longitude}, radius=${radiusKm}km`);

    // Find nearby ONLINE shops using Haversine formula
    // Only include verified/approved shopkeepers (is_verified = 1) with valid coordinates AND is_online = 1
    const [onlineShops] = await pool.query(
      `SELECT id, name, shop_name, address, phone, latitude, longitude, is_online, is_verified,
              (6371 * acos(
                 LEAST(1, GREATEST(-1,
                   cos(radians(?)) * cos(radians(latitude)) *
                   cos(radians(longitude) - radians(?)) +
                   sin(radians(?)) * sin(radians(latitude))
                 ))
              )) AS distance
       FROM shopkeepers
       WHERE latitude IS NOT NULL 
         AND longitude IS NOT NULL
         AND latitude != 0 
         AND longitude != 0
         AND is_verified = 1
         AND (is_online = 1 OR is_online IS NULL)
       HAVING distance <= ?
       ORDER BY distance ASC`,
      [latitude, longitude, latitude, radiusKm]
    );

    console.log(`✅ Found ${onlineShops.length} online verified shops within ${radiusKm}km`);

    // Find nearby OFFLINE shops (to show "Shop Offline" message)
    const [offlineShops] = await pool.query(
      `SELECT id, name, shop_name, address, phone, latitude, longitude, is_online,
              (6371 * acos(
                 LEAST(1, GREATEST(-1,
                   cos(radians(?)) * cos(radians(latitude)) *
                   cos(radians(longitude) - radians(?)) +
                   sin(radians(?)) * sin(radians(latitude))
                 ))
              )) AS distance
       FROM shopkeepers
       WHERE latitude IS NOT NULL 
         AND longitude IS NOT NULL
         AND latitude != 0 
         AND longitude != 0
         AND is_verified = 1
         AND is_online = 0
       HAVING distance <= ?
       ORDER BY distance ASC`,
      [latitude, longitude, latitude, radiusKm]
    );
    
    console.log(`📴 Found ${offlineShops.length} offline shops within ${radiusKm}km`);

    // Check for unverified shops nearby (for debugging)
    const [unverifiedShops] = await pool.query(
      `SELECT id, name, shop_name, is_verified, is_online,
              (6371 * acos(
                 LEAST(1, GREATEST(-1,
                   cos(radians(?)) * cos(radians(latitude)) *
                   cos(radians(longitude) - radians(?)) +
                   sin(radians(?)) * sin(radians(latitude))
                 ))
              )) AS distance
       FROM shopkeepers
       WHERE latitude IS NOT NULL 
         AND longitude IS NOT NULL
         AND latitude != 0 
         AND longitude != 0
         AND is_verified = 0
       HAVING distance <= ?
       ORDER BY distance ASC`,
      [latitude, longitude, latitude, radiusKm]
    );
    
    if (unverifiedShops.length > 0) {
      console.log(`⚠️ Found ${unverifiedShops.length} unverified shops nearby (not shown to users)`);
    }

    // If no online shops but there are offline shops nearby, return special response
    if (onlineShops.length === 0 && offlineShops.length > 0) {
      return res.json({ 
        success: true, 
        shops: [], 
        hasOfflineShops: true,
        offlineShopsCount: offlineShops.length,
        message: "Nearby shops are currently offline"
      });
    }

    if (onlineShops.length === 0) {
      return res.json({ success: true, shops: [], hasOfflineShops: false });
    }

    // Fetch products for each online shop directly from products table (products.shop_id)
    // Only include products with stock > 0 AND baselineQty > 0
    // baselineQty > 0 ensures shopkeeper has set up the product for auto-restock (product is actively managed)
    const shopIds = onlineShops.map(s => s.id);
    const [products] = await pool.query(
      `SELECT id AS product_id, shop_id, name, description, image, category, price, stock, created_at
       FROM products
       WHERE shop_id IN (?) AND stock > 0 AND baselineQty > 0
       ORDER BY created_at DESC`,
      [shopIds]
    );

    console.log(`📦 Found ${products.length} products across ${shopIds.length} shops`);

    // Group products under their shop, ensure address is never null/undefined
    // Add unit field based on stock quantity
    const shopsWithProducts = onlineShops.map(shop => ({
      ...shop,
      // Provide fallback address if not set
      address: shop.address || `Near coordinates (${parseFloat(shop.latitude).toFixed(4)}, ${parseFloat(shop.longitude).toFixed(4)})`,
      products: products
        .filter(p => p.shop_id === shop.id)
        .map(p => ({
          ...p,
          unit: p.stock > 1 ? `${p.stock} units available` : `${p.stock} unit available`
        })),
    }));

    res.json({ success: true, shops: shopsWithProducts, hasOfflineShops: offlineShops.length > 0 });
  } catch (err) {
    console.error("Nearby shops error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PUBLIC: Get shop info (for customers to check delivery settings)
userrouter.get("/shop-info/:shopId", async (req, res) => {
  try {
    const shopId = parseInt(req.params.shopId);
    
    if (!shopId || isNaN(shopId)) {
      return res.status(400).json({ success: false, message: "Invalid shop ID" });
    }

    const [shop] = await pool.query(
      `SELECT id, name, shop_name, address, phone, latitude, longitude, 
              is_online, is_verified, home_delivery_active
       FROM shopkeepers 
       WHERE id = ? AND is_verified = 1`,
      [shopId]
    );

    if (shop.length === 0) {
      return res.status(404).json({ success: false, message: "Shop not found" });
    }

    res.json({ 
      success: true, 
      shop: shop[0]
    });
  } catch (err) {
    console.error("Shop info error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

import { validateUserRegistration, createRateLimiter, validate } from "../middleware/validation.js";

// Rate limiting for auth endpoints
const authRateLimit = createRateLimiter(15 * 60 * 1000, 5); // 5 attempts per 15 minutes

// REGISTER
userrouter.post("/signup", authRateLimit, validate(validateUserRegistration), async (req, res) => {
  try {
    const validatedData = req.validatedData;

    // Check if user already exists
    const [existingUser] = await pool.query("SELECT * FROM users WHERE email = ?", [validatedData.email]);
    if (existingUser.length > 0) {
      return res.status(400).json({ success: false, message: "User already exists" });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(validatedData.password, 12); // Increased rounds for better security

    // Get the next available ID (since auto-increment isn't working)
    const [maxIdResult] = await pool.query("SELECT MAX(id) as maxId FROM users");
    const nextId = (maxIdResult[0].maxId || 0) + 1;

    // Insert new user into database with explicit ID
    await pool.query(
      "INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)",
      [nextId, validatedData.name, validatedData.email, hashedPassword]
    );

    // Fetch the newly created user
    const [userRows] = await pool.query("SELECT id, name, email, store_credits, created_at FROM users WHERE id = ?", [nextId]);
    const user = userRows[0];

  return res.json({ success: true, user, message: "User registered successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// LOGIN
userrouter.post("/signin", authRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Basic validation
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const [user] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (user.length === 0)
      return res.status(401).json({ success: false, message: "Invalid credentials" });

    const validPass = await bcrypt.compare(password, user[0].password);
    if (!validPass)
      return res.status(401).json({ success: false, message: "Invalid credentials" });

    // Defensive validation: Validate that user.id is not null before sending response
    if (!user[0].id || user[0].id === null || user[0].id === undefined) {
      console.error('⚠️ CRITICAL: User signin succeeded but user.id is null!', { 
        email: user[0].email,
        userId: user[0].id 
      });
      return res.status(500).json({ 
        success: false, 
        message: "Database error: User ID not found. Please contact support." 
      });
    }

    // Create JWE token with user info and role
    const token = await createJWEToken({ 
      id: user[0].id, 
      role: 'user',
      email: user[0].email 
    }, "7d");
    
    // Response logging: Log complete response structure being sent
    console.log('✅ User signin successful:', { 
      userId: user[0].id, 
      email: user[0].email,
      tokenLength: token?.length || 0,
      tokenType: 'JWE'
    });
    
    res.json({ 
      success: true, 
      token, 
      tokenType: 'JWE',
      user: { 
        id: user[0].id, 
        email: user[0].email, 
        name: user[0].name 
      } 
    });
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ success: false, message: "Server error during login" });
  }
});

// PROFILE
userrouter.get("/profile/:id", async (req, res) => {
  try {
    const [user] = await pool.query(
      "SELECT id, email, name, phone, address, area, landmark, pincode, img, store_credits, created_at FROM users WHERE id = ?", 
      [req.params.id]
    );
    if (user.length === 0)
      return res.status(404).json({ success: false, message: "User not found" });

    console.log(`✅ Profile fetched for user ${req.params.id}:`, {
      id: user[0].id,
      email: user[0].email,
      name: user[0].name,
      hasAddress: !!user[0].address
    });

    res.json({ success: true, user: user[0] });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// UPDATE PROFILE (with image upload)
userrouter.put("/profile/:id", upload.single("img"), async (req, res) => {
  try {
    const { name, phone, address, area, landmark, pincode } = req.body;
    const { id } = req.params;
    
    // First, check if user exists
    const [existingUser] = await pool.query("SELECT id FROM users WHERE id = ?", [id]);
    if (existingUser.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    let imgUrl = null;
    if (req.file) {
      // Use streamifier for cloudinary upload
      const streamifier = await import('streamifier');
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "users" },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        streamifier.default.createReadStream(req.file.buffer).pipe(stream);
      });
      imgUrl = result.secure_url;
      console.log("Cloudinary URL:", imgUrl);
    }
    
    const fields = [];
    const values = [];
    if (name) { fields.push("name = ?"); values.push(name); }
    if (phone) { fields.push("phone = ?"); values.push(phone); }
    if (address) { fields.push("address = ?"); values.push(address); }
    if (area !== undefined) { fields.push("area = ?"); values.push(area); }
    if (landmark !== undefined) { fields.push("landmark = ?"); values.push(landmark); }
    if (pincode !== undefined) { fields.push("pincode = ?"); values.push(pincode); }
    if (imgUrl) { fields.push("img = ?"); values.push(imgUrl); }
    
    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }
    
    values.push(id);
    const sql = `UPDATE users SET ${fields.join(", ")} WHERE id = ?`;
    await pool.query(sql, values);
    
    // Fetch updated user data
    const [userRows] = await pool.query(
      "SELECT id, name, email, phone, address, area, landmark, pincode, img, store_credits, created_at FROM users WHERE id = ?", 
      [id]
    );
    
    // Save address to AsyncStorage for quick access
    if (address) {
      console.log(`✅ Profile updated for user ${id} with address: ${address}`);
    }
    
    res.json({ success: true, user: userRows[0], message: "Profile updated successfully" });
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
userrouter.get("/products", async (req, res) => {
  try {
    // ✅ FIX: Return empty array instead of all products when location is not provided
    // This prevents showing products from all shops when location permission is denied
    // Users should only see products from nearby shops with proper location context
    console.log("⚠️ /products endpoint called without location - returning empty array");
    res.json({ 
      success: true, 
      products: [], 
      message: "Location required to view nearby products" 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
userrouter.get("/orders", verifyToken, async (req, res) => {
  try {
    const user_id = req.user.id;
    if (!user_id) {
      return res.status(401).json({ success: false, message: "User ID not found in token" });
    }
    const [rows] = await pool.query(
      `SELECT 
        o.id AS order_id,
        o.status,
        o.total_amount,
        o.created_at,
        o.delivery_address,
        o.pickup_code,
        o.delivery_mode,
        o.order_type,
        o.cancellation_reason,
        o.scheduled_time,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'product_id', oi.product_id,
            'product_name', p.name,
            'product_image', p.image,
            'quantity', oi.quantity,
            'price', oi.price
          )
        ) AS items
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE o.user_id = ?
       GROUP BY o.id, o.status, o.total_amount, o.created_at, o.delivery_address, o.pickup_code, o.delivery_mode, o.order_type, o.cancellation_reason, o.scheduled_time
       ORDER BY o.created_at DESC`,
      [user_id]
    );
    
    // Parse items if they come as JSON string
    const processedOrders = rows.map(order => {
      let items = order.items;
      
      // If items is a string, parse it
      if (typeof items === 'string') {
        try {
          items = JSON.parse(items);
        } catch (e) {
          console.error('Error parsing items for order', order.order_id, e);
          items = [];
        }
      }
      
      // Ensure items is an array
      if (!Array.isArray(items)) {
        items = [];
      }
      
      return {
        ...order,
        items
      };
    });
    
    console.log(`Fetched ${processedOrders.length} orders for user ${user_id}`);
    if (processedOrders.length > 0) {
      console.log('Sample order items:', processedOrders[0].items);
    }
    
    res.json({ success: true, orders: processedOrders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Clear all orders for a user (customer)
userrouter.delete("/orders/clear-user-orders", verifyToken, async (req, res) => {
  try {
    const user_id = req.user.id;
    if (!user_id) {
      return res.status(401).json({ success: false, message: "User ID not found in token" });
    }

    // First, delete all order items for this user's orders
    await pool.query(
      `DELETE oi FROM order_items oi
       INNER JOIN orders o ON oi.order_id = o.id
       WHERE o.user_id = ?`,
      [user_id]
    );

    // Then delete all orders for this user
    const [result] = await pool.query(
      `DELETE FROM orders WHERE user_id = ?`,
      [user_id]
    );

    console.log(`Cleared ${result.affectedRows} orders for user ${user_id}`);

    res.json({ 
      success: true, 
      message: "All orders cleared successfully",
      cleared_count: result.affectedRows
    });
  } catch (err) {
    console.error("Error clearing orders:", err);
    res.status(500).json({ success: false, message: "Server error while clearing orders" });
  }
});

userrouter.post("/orders", verifyToken, async (req, res) => {
  try {
    const user_id = req.user.id;
    if (!user_id) {
      return res.status(401).json({ success: false, message: "User ID not found in token" });
    }
    const { products, total, address, pointsToRedeem = 0, shopId, latitude, longitude } = req.body;
    const { order_type, scheduled_time } = req.body;
    
    // STRICT VALIDATION: Check all required fields
    if (!Array.isArray(products) || products.length === 0 || !total) {
      return res.status(400).json({ success: false, message: "Missing required fields: products and total are required" });
    }

    // STRICT VALIDATION: Address is COMPULSORY for ALL orders
    if (!address || typeof address !== 'string' || address.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Delivery address is required for all orders. Please update your profile with a valid address." 
      });
    }

    // STRICT VALIDATION: Address must be at least 10 characters
    if (address.trim().length < 10) {
      return res.status(400).json({ 
        success: false, 
        message: "Please provide a complete address with at least 10 characters." 
      });
    }

    const scheduledDate = scheduled_time ? new Date(scheduled_time) : null;
    if (!order_type || !["pickup", "delivery"].includes(order_type) || !scheduled_time || Number.isNaN(scheduledDate?.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid order type or scheduled time"
      });
    }

    // EXTRA STRICT VALIDATION: For home delivery, address must be detailed (at least 20 characters)
    if (order_type === 'delivery' && address.trim().length < 20) {
      return res.status(400).json({ 
        success: false, 
        message: "For home delivery, please provide a detailed address including house/flat number, street, and landmark (minimum 20 characters)." 
      });
    }

    // Validate that shopId is provided - orders must go to a single shop
    if (!shopId) {
      return res.status(400).json({ success: false, message: "Shop ID is required. Orders must be placed with a single shop." });
    }

    // Verify the shop exists and is verified
    const [[shop]] = await pool.query(
      "SELECT id, name, shop_name, expo_push_token, latitude, longitude FROM shopkeepers WHERE id = ? AND is_verified = 1",
      [shopId]
    );
    if (!shop) {
      return res.status(400).json({ success: false, message: "Shop not found or not verified" });
    }

    // Verify all products belong to this shop AND have sufficient stock
    const productIds = products.map(p => p.product_id);
    const [prodRows] = await pool.query("SELECT id, shop_id, name, stock FROM products WHERE id IN (?)", [productIds]);
    
    // Create a map for quick lookup
    const productMap = new Map(prodRows.map(p => [p.id, p]));
    
    // Validate shop ownership and stock availability
    for (const orderItem of products) {
      const product = productMap.get(orderItem.product_id);
      
      if (!product) {
        return res.status(400).json({ 
          success: false, 
          message: `Product with ID ${orderItem.product_id} not found.` 
        });
      }
      
      if (product.shop_id !== shopId) {
        return res.status(400).json({ 
          success: false, 
          message: "All products must belong to the same shop. Please order from one shop at a time." 
        });
      }
      
      // Check stock availability
      if (product.stock < orderItem.quantity) {
        return res.status(400).json({ 
          success: false, 
          message: `Insufficient stock for "${product.name}". Available: ${product.stock}, Requested: ${orderItem.quantity}` 
        });
      }
      
      // Check for zero stock
      if (product.stock === 0) {
        return res.status(400).json({ 
          success: false, 
          message: `"${product.name}" is out of stock. Please remove it from your cart.` 
        });
      }
    }

    // Handle wellness points redemption if requested
    let pointsDiscount = 0;
    if (pointsToRedeem > 0) {
      try {
        // Get user's current points
        const [[user]] = await pool.query('SELECT store_credits FROM users WHERE id = ?', [user_id]);
        if (!user) {
          return res.status(404).json({ success: false, message: "User not found" });
        }

        // Validate points usage
        const validation = validatePointsUsage(pointsToRedeem, user.store_credits, total);
        if (!validation.valid) {
          return res.status(400).json({ success: false, message: validation.message });
        }

        // Deduct points and calculate discount
        const pointsResult = await deductWellnessPoints(pool, user_id, pointsToRedeem);
        pointsDiscount = pointsResult.discountAmount;
      } catch (pointsError) {
        console.error("Error processing wellness points:", pointsError);
        return res.status(400).json({ success: false, message: pointsError.message });
      }
    }

    // Calculate final total after discount
    const finalTotal = total - pointsDiscount;

    // Get next order ID (TiDB doesn't support auto-increment reliably)
    const [maxOrderId] = await pool.query("SELECT COALESCE(MAX(id), 0) + 1 as nextId FROM orders");
    const orderId = maxOrderId[0].nextId;
    
    // Generate 6-digit pickup code for timer verification
    const pickupCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // ⏱️ TIMER STARTS NOW - Customer must reach shop within 7 minutes
    // Timer starts automatically when order is placed (FIT INDIA challenge)
    const timerDuration = 420; // 7 minutes in seconds
    const timerStartedAt = new Date();
    const timerExpiresAt = new Date(timerStartedAt.getTime() + (timerDuration * 1000));
    
    console.log(`⏱️ Timer started for order ${orderId}: ${timerStartedAt.toISOString()} -> expires: ${timerExpiresAt.toISOString()}`);

    // Insert single order for the selected shop with timer info
    console.log(`Creating order ${orderId} for user ${user_id} with shopkeeper ${shopId} (type: ${typeof shopId})`);
    const orderTypeValue = order_type || "pickup";
    const deliveryModeValue = order_type || "pickup"; // delivery_mode should match order_type
    const scheduledTimeValue = scheduled_time || null;
    await pool.query(
      `INSERT INTO orders (id, user_id, shopkeeper_id, total_amount, delivery_address, order_type, delivery_mode, scheduled_time, status, credits_used, latitude, longitude, has_timer, pickup_code, timer_started_at, timer_expires_at, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [orderId, user_id, shopId, finalTotal, address, orderTypeValue, deliveryModeValue, scheduledTimeValue, "Pending", pointsToRedeem, latitude || null, longitude || null, true, pickupCode, timerStartedAt, timerExpiresAt]
    );

    // Create timer record in order_timers table
    try {
      await pool.query(`
        INSERT INTO order_timers (order_id, pickup_code, timer_duration, timer_started_at, timer_expires_at, is_active)
        VALUES (?, ?, ?, ?, ?, TRUE)
      `, [orderId, pickupCode, timerDuration, timerStartedAt, timerExpiresAt]);
    } catch (timerError) {
      console.warn("Timer record creation failed (table may not exist):", timerError.message);
    }

    // Insert order items and deduct stock
    for (const item of products) {
      const [maxItemId] = await pool.query("SELECT COALESCE(MAX(id), 0) + 1 as nextId FROM order_items");
      const itemId = maxItemId[0].nextId;
      await pool.query(
        "INSERT INTO order_items (id, order_id, product_id, quantity, price) VALUES (?, ?, ?, ?, ?)",
        [itemId, orderId, item.product_id, item.quantity, item.price]
      );
      
      // Deduct stock from inventory
      await pool.query(
        "UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?",
        [item.quantity, item.product_id, item.quantity]
      );
    }

    // Notify shopkeeper and send real-time updates
    try {
      // Get product details for notification
      const itemIds = products.map(i => i.product_id);
      const [productDetails] = await pool.query("SELECT id, name, image FROM products WHERE id IN (?)", [itemIds]);
      const productMap = new Map(productDetails.map(p => [p.id, p]));
      
      const enrichedItems = products.map(item => ({
        ...item,
        name: productMap.get(item.product_id)?.name || 'Unknown Product',
        image: productMap.get(item.product_id)?.image || null
      }));

      // Build payload for real-time updates
      const orderPayload = {
        orderId,
        total: finalTotal,
        status: "Pending",
        address,
        order_type: orderTypeValue,
        scheduled_time: scheduledTimeValue,
        items: enrichedItems,
        user_id,
        shop_id: shopId,
        created_at: new Date().toISOString(),
      };

      // Emit socket events
      try {
        if (req.io) {
          const shopRoom = `shop_${Number(shopId)}`;
          const customerRoom = `customer_${Number(user_id)}`;
          console.log(`Emitting newOrder to ${shopRoom} and ${customerRoom} for order ${orderId}`);
          req.io.to(shopRoom).emit("newOrder", orderPayload);
          req.io.to(customerRoom).emit("newOrder", orderPayload);
        } else {
          console.warn("req.io not available for socket emission");
        }
      } catch (emitErr) {
        console.warn("Socket emit failed for shop", shopId, emitErr);
      }

      // Send push notification to shopkeeper (supports both FCM and Expo tokens)
      try {
        const token = shop?.expo_push_token;
        console.log(`\n📱 Push Notification Check for Order #${orderId}:`);
        console.log(`Shop ID: ${shopId}`);
        console.log(`Shop Name: ${shop.shop_name}`);
        console.log(`Token exists: ${!!token}`);
        
        if (token) {
          console.log(`Token type: ${isFCMToken(token) ? 'FCM' : 'Expo'}`);
          console.log(`Token preview: ${token.substring(0, 30)}...`);
          
          let result;
          // Check if it's an FCM token or Expo token
          if (isFCMToken(token)) {
            console.log(`📤 Sending FCM notification...`);
            result = await sendFCMPush(
              token,
              "📦 New Order Received!",
              `You have a new order (#${orderId}) worth ₹${finalTotal}.`,
              { orderId: String(orderId), shopId: String(shopId) }
            );
            console.log(`FCM Result:`, JSON.stringify(result, null, 2));
          } else {
            console.log(`📤 Sending Expo notification...`);
            result = await sendExpoPush(
              token,
              "📦 New Order Received!",
              `You have a new order (#${orderId}) worth ₹${finalTotal}.`,
              { orderId, shopId }
            );
            console.log(`Expo Result:`, JSON.stringify(result, null, 2));
          }

          if (result?.success) {
            console.log(`✅ Notification sent successfully!`);
          } else {
            console.error(`❌ Notification failed:`, result?.message || 'Unknown error');
          }

          if (result?.invalidTokens?.length) {
            console.warn(`⚠️ Clearing ${result.invalidTokens.length} invalid token(s)`);
            await pool.query("UPDATE shopkeepers SET expo_push_token = NULL WHERE expo_push_token IN (?)", [result.invalidTokens]);
            console.warn("Cleared invalid shopkeeper tokens:", result.invalidTokens);
          }
        } else {
          console.warn(`⚠️ No push token found for shopkeeper ${shopId}`);
          console.warn(`Shopkeeper will not receive push notification`);
          console.warn(`Token should be saved when shopkeeper logs in`);
        }
      } catch (pushErr) {
        console.error("❌ Error sending push to shopkeeper", shopId, pushErr);
        console.error("Push error details:", pushErr.message);
        console.error("Push error stack:", pushErr.stack);
      }
    } catch (notifyErr) {
      console.error("Error notifying shopkeeper:", notifyErr);
    }

    res.json({ 
      success: true, 
      order: { 
        order_id: orderId, 
        shopkeeper_id: shopId, 
        total: finalTotal,
        pickup_code: pickupCode,
        timer_duration: timerDuration,
        timer_started_at: timerStartedAt,
        timer_expires_at: timerExpiresAt,
        shop_name: shop.shop_name,
        shop_latitude: shop.latitude,
        shop_longitude: shop.longitude
      },
      message: "Order placed successfully! 7-minute timer is already running - head to the shop now!",
      pointsRedeemed: pointsToRedeem,
      pointsDiscount: pointsDiscount,
      finalTotal: finalTotal
    });
  } catch (err) {
    console.error('❌ Order creation error:', err);
    console.error('Error stack:', err.stack);
    console.error('Error details:', {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlMessage: err.sqlMessage
    });
    
    // Provide more specific error messages
    let errorMessage = "Server error";
    
    if (err.code === 'ER_DUP_ENTRY') {
      errorMessage = "Duplicate order detected. Please try again.";
    } else if (err.code === 'ER_NO_REFERENCED_ROW' || err.code === 'ER_NO_REFERENCED_ROW_2') {
      errorMessage = "Invalid shop or product reference. Please refresh and try again.";
    } else if (err.message?.includes('stock')) {
      errorMessage = "Stock validation failed. Please refresh your cart.";
    } else if (err.message?.includes('points') || err.message?.includes('credits')) {
      errorMessage = err.message; // Use the specific points error message
    } else if (err.errno === 'ECONNREFUSED') {
      errorMessage = "Database connection failed. Please try again.";
    } else if (err.message) {
      errorMessage = err.message;
    }
    
    res.status(500).json({ 
      success: false, 
      message: errorMessage,
      code: err.code || 'UNKNOWN_ERROR'
    });
  }
});

// Cancel order (customer cancellation)
userrouter.post("/orders/:orderId/cancel", verifyToken, async (req, res) => {
  try {
    const user_id = req.user.id;
    const { orderId } = req.params;
    
    const orderIdNum = parseInt(orderId);
    if (isNaN(orderIdNum)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }
    
    console.log(`🚫 Customer ${user_id} cancelling order ${orderIdNum}`);
    
    // Check if order belongs to this user and is cancellable
    const [[order]] = await pool.query(
      "SELECT id, user_id, shopkeeper_id, status FROM orders WHERE id = ? AND user_id = ?",
      [orderIdNum, user_id]
    );
    
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    
    // Only allow cancellation of Pending orders
    if (order.status !== 'Pending') {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot cancel order with status: ${order.status}. Only pending orders can be cancelled.` 
      });
    }

    // Start transaction for order cancellation and stock restoration
    await pool.query("START TRANSACTION");
    
    try {
      // Update order status to Cancelled
      await pool.query(
        "UPDATE orders SET status = 'Cancelled' WHERE id = ?",
        [orderIdNum]
      );
      
      // Restore stock using the stock manager utility
      const stockRestoration = await restoreStockForCancelledOrder(
        orderIdNum, 
        'customer', 
        'Customer cancellation'
      );
      
      // Commit transaction
      await pool.query("COMMIT");
      
      if (stockRestoration.success) {
        console.log(`✅ Order ${orderIdNum} cancelled and stock restored successfully`);
      } else {
        console.log(`⚠️ Order ${orderIdNum} cancelled but stock restoration had issues:`, stockRestoration.message);
      }
      
    } catch (transactionError) {
      // Rollback transaction on error
      await pool.query("ROLLBACK");
      console.error(`❌ Transaction failed for order ${orderIdNum}:`, transactionError);
      throw transactionError;
    }
    
    // Broadcast cancellation via sockets to shopkeeper
    try {
      if (req.io) {
        // Convert IDs to numbers for consistent room naming
        const shopRoom = `shop_${Number(order.shopkeeper_id)}`;
        const customerRoom = `customer_${Number(user_id)}`;
        
        console.log(`📡 Socket: Emitting order cancellation`);
        console.log(`📡 Socket: Shop room: ${shopRoom} (shopkeeper_id: ${order.shopkeeper_id})`);
        console.log(`📡 Socket: Customer room: ${customerRoom} (user_id: ${user_id})`);
        
        const cancellationData = {
          orderId: orderIdNum,
          status: 'Cancelled',
          stockRestored: true,
          restoredItems: stockRestoration.success ? stockRestoration.totalItemsRestored : 0
        };
        console.log(`📡 Socket: Payload:`, cancellationData);
        
        // Emit to shopkeeper room
        req.io.to(shopRoom).emit("orderStatusUpdate", cancellationData);
        console.log(`📡 Socket: ✅ Emitted to ${shopRoom}`);
        
        // Emit to customer room
        req.io.to(customerRoom).emit("orderStatusUpdate", cancellationData);
        console.log(`📡 Socket: ✅ Emitted to ${customerRoom}`);
        
        // Also emit orderStatusChanged for backward compatibility
        req.io.to(shopRoom).emit("orderStatusChanged", cancellationData);
        req.io.to(customerRoom).emit("orderStatusChanged", cancellationData);
        console.log(`📡 Socket: ✅ Also emitted orderStatusChanged events`);
      } else {
        console.error(`📡 Socket: ❌ req.io is not available! Cannot emit socket events.`);
      }
      
      // Send push notification to shopkeeper
      const [[shopkeeper]] = await pool.query(
        "SELECT expo_push_token FROM shopkeepers WHERE id = ?",
        [order.shopkeeper_id]
      );
      
      if (shopkeeper?.expo_push_token) {
        const token = shopkeeper.expo_push_token;
        console.log(`📱 Push: Sending cancellation notification to shopkeeper ${order.shopkeeper_id}`);
        const stockMessage = stockRestoration.success ? " Stock has been restored." : "";
        if (isFCMToken(token)) {
          await sendFCMPush(token, "Order Cancelled", `Order #${orderIdNum} has been cancelled by the customer.${stockMessage}`, { orderId: String(orderIdNum), status: 'Cancelled' });
        } else {
          await sendExpoPush(token, "Order Cancelled", `Order #${orderIdNum} has been cancelled by the customer.${stockMessage}`, { orderId: orderIdNum, status: 'Cancelled' });
        }
        console.log(`📱 Push: ✅ Notification sent successfully`);
      } else {
        console.log(`📱 Push: No push token found for shopkeeper ${order.shopkeeper_id}`);
      }
    } catch (notifyErr) {
      console.error("❌ Notification error:", notifyErr);
      // Don't fail the cancellation if notification fails
    }
    
    res.json({ 
      success: true, 
      message: stockRestoration.success ? 
        "Order cancelled successfully and stock restored" : 
        "Order cancelled successfully but stock restoration had issues",
      orderId: orderIdNum,
      stockRestoration: stockRestoration
    });
  } catch (err) {
    console.error("Cancel order error:", err);
    res.status(500).json({ success: false, message: "Server error during cancellation" });
  }
});

// Save expo push token for authenticated user
userrouter.post("/push-token", verifyToken, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: "token is required" });

    await pool.query("UPDATE users SET expo_push_token = ? WHERE id = ?", [token, req.user.id]);
    return res.json({ success: true, message: "Push token saved" });
  } catch (err) {
    console.error("Save user push token error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ==================== ORDER TIMER TRACKING FOR CUSTOMERS ====================

// Get timer status for customer's order
userrouter.get("/orders/:orderId/timer", verifyToken, async (req, res) => {
  try {
    const user_id = req.user.id;
    const { orderId } = req.params;

    const orderIdNum = parseInt(orderId);
    if (isNaN(orderIdNum)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    // Get timer info for customer's order
    const [timerInfo] = await pool.query(`
      SELECT o.id, o.status, o.has_timer, o.pickup_code, o.timer_started_at, o.timer_expires_at,
             ot.timer_duration, ot.is_active, ot.is_expired, ot.stopped_at,
             s.shop_name, s.name as shopkeeper_name, s.phone as shopkeeper_phone
      FROM orders o
      LEFT JOIN order_timers ot ON o.id = ot.order_id
      LEFT JOIN shopkeepers s ON o.shopkeeper_id = s.id
      WHERE o.id = ? AND o.user_id = ?
    `, [orderIdNum, user_id]);

    if (timerInfo.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Order not found" 
      });
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
          shop_name: timer.shop_name,
          shopkeeper_name: timer.shopkeeper_name,
          shopkeeper_phone: timer.shopkeeper_phone
        }
      }
    });

  } catch (err) {
    console.error("Get customer timer error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Force refresh timer status for customer - useful for frontend debugging
userrouter.get("/orders/:orderId/timer/refresh", verifyToken, async (req, res) => {
  try {
    const user_id = req.user.id;
    const { orderId } = req.params;

    const orderIdNum = parseInt(orderId);
    if (isNaN(orderIdNum)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    console.log(`🔄 Customer force refreshing timer status for order ${orderIdNum}`);

    // Get complete timer info for customer's order
    const [timerInfo] = await pool.query(`
      SELECT o.id, o.status, o.has_timer, o.pickup_code, o.timer_started_at, o.timer_expires_at,
             ot.timer_duration, ot.is_active, ot.is_expired, ot.stopped_at,
             s.shop_name, s.name as shopkeeper_name, s.phone as shopkeeper_phone,
             o.shopkeeper_id
      FROM orders o
      LEFT JOIN order_timers ot ON o.id = ot.order_id
      LEFT JOIN shopkeepers s ON o.shopkeeper_id = s.id
      WHERE o.id = ? AND o.user_id = ?
    `, [orderIdNum, user_id]);

    if (timerInfo.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Order not found" 
      });
    }

    const timer = timerInfo[0];
    let timeLeft = 0;

    if (timer.is_active && timer.timer_expires_at) {
      const now = new Date();
      const expiresAt = new Date(timer.timer_expires_at);
      timeLeft = Math.max(0, Math.floor((expiresAt - now) / 1000));
    }

    const response = {
      success: true, 
      timer: {
        order_id: timer.id,
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
          shop_name: timer.shop_name,
          shopkeeper_name: timer.shopkeeper_name,
          shopkeeper_phone: timer.shopkeeper_phone
        }
      },
      debug_info: {
        order_status: timer.status,
        timer_stopped: !!timer.stopped_at,
        timer_active: timer.is_active,
        current_time: new Date().toISOString()
      }
    };

    console.log(`🔄 Customer timer refresh response for order ${orderIdNum}:`, JSON.stringify(response, null, 2));

    // If timer is stopped, emit socket events again to ensure frontend receives them
    if (timer.stopped_at && timer.status === 'Completed') {
      console.log(`📡 Re-emitting customer timer stopped events for order ${orderIdNum}`);
      
      if (req.io) {
        const customerRoom = `customer_${Number(user_id)}`;
        const shopRoom = `shop_${Number(timer.shopkeeper_id)}`;
        
        const socketPayload = { 
          orderId: orderIdNum, 
          status: 'Completed',
          timerStopped: true,
          stoppedAt: timer.stopped_at,
          refreshed: true
        };
        
        req.io.to(customerRoom).emit("orderStatusUpdate", socketPayload);
        req.io.to(customerRoom).emit("timerStopped", { 
          orderId: orderIdNum, 
          stoppedAt: timer.stopped_at,
          refreshed: true
        });
        
        console.log(`📡 Re-emitted customer events to ${customerRoom}`);
      }
    }

    res.json(response);

  } catch (err) {
    console.error("Customer timer refresh error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get order status for customer
userrouter.get("/orders/:orderId/status", verifyToken, async (req, res) => {
  try {
    const user_id = req.user.id;
    const { orderId } = req.params;

    const orderIdNum = parseInt(orderId);
    if (isNaN(orderIdNum)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    const [orderInfo] = await pool.query(`
      SELECT o.id, o.status, o.has_timer, o.pickup_code, o.timer_started_at, o.timer_expires_at,
             o.total_amount, o.created_at, o.credits_earned,
             s.shop_name, s.name as shopkeeper_name
      FROM orders o
      LEFT JOIN shopkeepers s ON o.shopkeeper_id = s.id
      WHERE o.id = ? AND o.user_id = ?
    `, [orderIdNum, user_id]);

    if (orderInfo.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Order not found" 
      });
    }

    res.json({ 
      success: true, 
      order: orderInfo[0]
    });

  } catch (err) {
    console.error("Get order status error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get detailed order info for customer
userrouter.get("/orders/:orderId", verifyToken, async (req, res) => {
  try {
    const user_id = req.user.id;
    const { orderId } = req.params;

    const orderIdNum = parseInt(orderId);
    if (isNaN(orderIdNum)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    // Get order details with items
    const [orderInfo] = await pool.query(`
      SELECT 
        o.id AS order_id,
        o.status,
        o.total_amount,
        o.created_at,
        o.credits_earned,
        o.has_timer,
        o.pickup_code,
        o.timer_started_at,
        o.timer_expires_at,
        o.delivery_address,
        s.shop_name,
        s.name AS shopkeeper_name,
        s.phone AS shopkeeper_phone,
        s.address AS shop_address,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'product_id', oi.product_id,
            'product_name', p.name,
            'product_image', p.image,
            'quantity', oi.quantity,
            'price', oi.price
          )
        ) AS items
       FROM orders o
       JOIN shopkeepers s ON o.shopkeeper_id = s.id
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       WHERE o.id = ? AND o.user_id = ?
       GROUP BY o.id
    `, [orderIdNum, user_id]);

    if (orderInfo.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Order not found" 
      });
    }

    const order = orderInfo[0];

    // Get timer info if available
    let timerInfo = null;
    if (order.has_timer) {
      const [timerData] = await pool.query(`
        SELECT timer_duration, is_active, is_expired, stopped_at
        FROM order_timers
        WHERE order_id = ?
      `, [orderIdNum]);

      if (timerData.length > 0) {
        const timer = timerData[0];
        let timeLeft = 0;

        if (timer.is_active && order.timer_expires_at) {
          const now = new Date();
          const expiresAt = new Date(order.timer_expires_at);
          timeLeft = Math.max(0, Math.floor((expiresAt - now) / 1000));
        }

        timerInfo = {
          is_active: timer.is_active,
          is_expired: timer.is_expired,
          time_left: timeLeft,
          timer_duration: timer.timer_duration,
          started_at: order.timer_started_at,
          expires_at: order.timer_expires_at,
          stopped_at: timer.stopped_at
        };
      }
    }

    res.json({ 
      success: true, 
      order: {
        ...order,
        timer: timerInfo
      }
    });

  } catch (err) {
    console.error("Get order details error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get shop location for customer
userrouter.get("/shops/:shopId/location", verifyToken, async (req, res) => {
  try {
    const { shopId } = req.params;

    const [shop] = await pool.query(`
      SELECT id, shop_name, name as shopkeeper_name, address, 
             latitude, longitude, phone, created_at
      FROM shopkeepers 
      WHERE id = ? AND is_verified = 1
    `, [shopId]);

    if (shop.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Shop not found or not verified" 
      });
    }

    const shopData = shop[0];
    
    res.json({ 
      success: true, 
      shop: {
        id: shopData.id,
        name: shopData.shop_name,
        shopkeeper: shopData.shopkeeper_name,
        address: shopData.address,
        location: {
          latitude: shopData.latitude,
          longitude: shopData.longitude
        },
        phone: shopData.phone,
        verified: true
      }
    });

  } catch (err) {
    console.error("Get shop location error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default userrouter;
