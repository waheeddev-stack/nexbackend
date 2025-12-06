import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import { sendExpoPush } from "../utils/expoPush.js";
import dotenv from "dotenv";
import upload from "../config/upload.js";
import cloudinary from "../config/cloudinary.js";
import  verifyToken  from "../middleware/auth.js";
import { deductWellnessPoints, validatePointsUsage } from "../utils/wellnessPoints.js";

dotenv.config();

const userrouter = express.Router();

// Find nearby shopkeepers and show their products
userrouter.get("/nearby-shops", async (req, res) => {
  try {
    const { latitude, longitude, radiusKm = 2 } = req.query;
    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, message: "Missing location" });
    }

    // Find nearby shops using Haversine formula
    const [shops] = await pool.query(
      `SELECT id, name, shop_name, latitude, longitude,
              (6371 * acos(
                 cos(radians(?)) * cos(radians(latitude)) *
                 cos(radians(longitude) - radians(?)) +
                 sin(radians(?)) * sin(radians(latitude))
              )) AS distance
       FROM shopkeepers
       HAVING distance <= ?
       ORDER BY distance ASC`,
      [latitude, longitude, latitude, radiusKm]
    );

    if (shops.length === 0) {
      return res.json({ success: true, shops: [] });
    }

    // Fetch products for each shop directly from products table (products.shop_id)
    const shopIds = shops.map(s => s.id);
    const [products] = await pool.query(
      `SELECT id AS product_id, shop_id, name, description, image, category, price, stock, created_at
       FROM products
       WHERE shop_id IN (?)
       ORDER BY created_at DESC`,
      [shopIds]
    );

    // Group products under their shop
    const shopsWithProducts = shops.map(shop => ({
      ...shop,
      products: products.filter(p => p.shop_id === shop.id),
    }));

    res.json({ success: true, shops: shopsWithProducts });
  } catch (err) {
    console.error("Nearby shops error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

import { validate, validateUserRegistration, createRateLimiter } from "../middleware/validation.js";

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
    const [result] = await pool.query(
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

    const token = jwt.sign({ id: user[0].id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({ success: true, token, user: { id: user[0].id, email: user[0].email, name: user[0].name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PROFILE
userrouter.get("/profile/:id", async (req, res) => {
  try {
    const [user] = await pool.query("SELECT id, email, name, phone, address, img, store_credits, created_at FROM users WHERE id = ?", [req.params.id]);
    if (user.length === 0)
      return res.status(404).json({ success: false, message: "User not found" });

    res.json({ success: true, user: user[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// UPDATE PROFILE (with image upload)
userrouter.put("/profile/:id", upload.single("img"), async (req, res) => {
  try {
    const { name, phone, address } = req.body;
    const { id } = req.params;
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
    if (imgUrl) { fields.push("img = ?"); values.push(imgUrl); }
    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }
    values.push(id);
    const sql = `UPDATE users SET ${fields.join(", ")} WHERE id = ?`;
    await pool.query(sql, values);
    const [userRows] = await pool.query("SELECT id, name, email, phone, address, img, store_credits, created_at FROM users WHERE id = ?", [id]);
    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, user: userRows[0], message: "Profile updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
userrouter.get("/products", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM products ORDER BY created_at DESC");
    res.json({ success: true, products: rows });
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
       GROUP BY o.id, o.status, o.total_amount, o.created_at, o.delivery_address
       ORDER BY o.created_at DESC`,
      [user_id]
    );
    res.json({ success: true, orders: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

userrouter.post("/orders", verifyToken, async (req, res) => {
  try {
    const user_id = req.user.id;
    if (!user_id) {
      return res.status(401).json({ success: false, message: "User ID not found in token" });
    }
    const { products, total, address, pointsToRedeem = 0 } = req.body;
    if (!Array.isArray(products) || products.length === 0 || !total || !address) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
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

    // Get shopkeeper IDs from products and create separate orders per shopkeeper
    const productIds = products.map(p => p.product_id);
    const [prodRows] = await pool.query("SELECT id, shop_id FROM products WHERE id IN (?)", [productIds]);
    const productToShop = new Map(prodRows.map((p) => [p.id, p.shop_id]));

    // Group products by shopkeeper
    const ordersByShop = new Map();
    for (const item of products) {
      const shopId = productToShop.get(item.product_id);
      if (!shopId) {
        return res.status(400).json({ success: false, message: `Product ${item.product_id} not found or has no shopkeeper` });
      }
      
      if (!ordersByShop.has(shopId)) {
        ordersByShop.set(shopId, []);
      }
      ordersByShop.get(shopId).push(item);
    }

    const createdOrders = [];

    // Create separate order for each shopkeeper
    for (const [shopId, shopItems] of ordersByShop) {
      const shopSubtotal = shopItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      
      // Apply proportional discount from wellness points
      const shopDiscountRatio = shopSubtotal / total;
      const shopDiscount = pointsDiscount * shopDiscountRatio;
      const shopTotal = shopSubtotal - shopDiscount;
      
      // Insert order for this shopkeeper
      const [orderResult] = await pool.query(
        "INSERT INTO orders (user_id, shopkeeper_id, total_amount, delivery_address, status, credits_used) VALUES (?, ?, ?, ?, ?, ?)",
        [user_id, shopId, shopTotal, address, "Pending", pointsToRedeem]
      );
      const orderId = orderResult.insertId;

      // Insert order items for this order
      for (const item of shopItems) {
        await pool.query(
          "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)",
          [orderId, item.product_id, item.quantity, item.price]
        );
      }

      createdOrders.push({
        orderId,
        shopId,
        shopTotal,
        items: shopItems
      });
    }

    // Notify shopkeepers and send real-time updates
    try {
      for (const order of createdOrders) {
        const { orderId, shopId, shopTotal, items } = order;
        
        // Get product details for notification
        const itemIds = items.map(i => i.product_id);
        const [productDetails] = await pool.query("SELECT id, name, image FROM products WHERE id IN (?)", [itemIds]);
        const productMap = new Map(productDetails.map(p => [p.id, p]));
        
        const enrichedItems = items.map(item => ({
          ...item,
          name: productMap.get(item.product_id)?.name || 'Unknown Product',
          image: productMap.get(item.product_id)?.image || null
        }));

        // Build payload for real-time updates
        const orderPayload = {
          orderId,
          total: shopTotal,
          status: "Pending",
          address,
          items: enrichedItems,
          user_id,
          shop_id: shopId,
          created_at: new Date().toISOString(),
        };

        // Emit socket events
        try {
          if (req.io) {
            req.io.to(`shop_${shopId}`).emit("newOrder", orderPayload);
            req.io.to(`customer_${user_id}`).emit("newOrder", orderPayload);
          }
        } catch (emitErr) {
          console.warn("Socket emit failed for shop", shopId, emitErr);
        }

        // Send push notification to shopkeeper
        try {
          const [[shop]] = await pool.query("SELECT id, name, expo_push_token FROM shopkeepers WHERE id = ?", [shopId]);
          const token = shop?.expo_push_token;
          if (token) {
            const result = await sendExpoPush(
              token,
              "📦 New Order Received!",
              `You have a new order (#${orderId}) worth ₹${shopTotal}.`,
              { orderId, shopId }
            );

            if (result?.invalidTokens?.length) {
              await pool.query("UPDATE shopkeepers SET expo_push_token = NULL WHERE expo_push_token IN (?)", [result.invalidTokens]);
              console.warn("Cleared invalid shopkeeper tokens:", result.invalidTokens);
            }
          }
        } catch (pushErr) {
          console.error("Error sending push to shopkeeper", shopId, pushErr);
        }
      }
    } catch (notifyErr) {
      console.error("Error notifying shopkeepers:", notifyErr);
    }

    res.json({ 
      success: true, 
      orders: createdOrders.map(o => ({ order_id: o.orderId, shopkeeper_id: o.shopId, total: o.shopTotal })),
      message: `${createdOrders.length} order(s) placed successfully`,
      pointsRedeemed: pointsToRedeem,
      pointsDiscount: pointsDiscount,
      finalTotal: total - pointsDiscount
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
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
