import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import express from "express";
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
  canAccessApp,
} from "../utils/subscription.js";
import { createJWEToken } from "../utils/jweToken.js";
import { restoreStockForCancelledOrder } from "../utils/stockManager.js";

// Middleware to check if shopkeeper is verified (compatible with existing database)
const verifyShopkeeperStatus = async (req, res, next) => {
  try {
    const [user] = await pool.execute("SELECT * FROM shopkeepers WHERE id = ?", [
      req.user.id,
    ]);

    if (user.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Shopkeeper not found" });
    }

    // Check verification status with proper handling for all states
    const shopkeeper = user[0];
    const verificationStatus = shopkeeper.is_verified;

    if (verificationStatus === 0) {
      // Rejected
      return res.status(403).json({
        success: false,
        message:
          "Your account has been denied. Please contact support for more information.",
        verification_status: "rejected",
      });
    } else if (
      verificationStatus === null ||
      verificationStatus === "" ||
      verificationStatus === undefined
    ) {
      // Pending
      return res.status(403).json({
        success: false,
        message:
          "Your account is pending verification. Please wait for admin approval.",
        verification_status: "pending",
      });
    } else if (verificationStatus !== 1) {
      // Any other invalid status
      return res.status(403).json({
        success: false,
        message:
          "Your account verification status is unclear. Please contact support.",
        verification_status: "unknown",
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

shopkeeperRouter.get(
  "/stats",
  verifyToken,
  verifyShopkeeperStatus,
  checkSubscriptionStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;

      // Get top selling product for this specific shopkeeper (products table contains shop_id)
      const [[topProduct]] = await pool.execute(
        `
        SELECT p.name, SUM(oi.quantity) AS sold
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        JOIN orders o ON oi.order_id = o.id
        WHERE o.shopkeeper_id = ? AND p.shop_id = ?
        GROUP BY p.id
        ORDER BY sold DESC
        LIMIT 1
      `,
        [shopkeeper_id, shopkeeper_id]
      );

      // Get stats for this specific shopkeeper only
      const [[totalSales]] = await pool.execute(
        "SELECT SUM(total_amount) AS totalSales FROM orders WHERE status='Completed' AND shopkeeper_id = ?",
        [shopkeeper_id]
      );
      const [[totalDelivered]] = await pool.execute(
        "SELECT COUNT(*) AS totalDelivered FROM orders WHERE status='Completed' AND shopkeeper_id = ?",
        [shopkeeper_id]
      );
      const [[totalPending]] = await pool.execute(
        "SELECT COUNT(*) AS totalPending FROM orders WHERE status='Pending' AND shopkeeper_id = ?",
        [shopkeeper_id]
      );
      const [[totalCancelled]] = await pool.execute(
        "SELECT COUNT(*) AS totalCancelled FROM orders WHERE status='Cancelled' AND shopkeeper_id = ?",
        [shopkeeper_id]
      );
      const [[totalCompleted]] = await pool.execute(
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
  }
);

// ============================================================================
// DASHBOARD SUMMARY API
// ============================================================================
// GET /api/shopkeeper/dashboard/summary - Get complete dashboard data
shopkeeperRouter.get(
  "/dashboard/summary",
  verifyToken,
  verifyShopkeeperStatus,
  checkSubscriptionStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;

      // Get shopkeeper details including online status and home delivery status
      const [[shopkeeper]] = await pool.execute(
        "SELECT is_online, subscription_status, last_payment_date, next_payment_due FROM shopkeepers WHERE id = ?",
        [shopkeeper_id]
      );

      if (!shopkeeper) {
        return res
          .status(404)
          .json({ success: false, message: "Shopkeeper not found" });
      }

      // No trial period - billing starts from day 1

      // Get total sales (only completed/delivered orders)
      const [[salesData]] = await pool.execute(
        "SELECT SUM(total_amount) AS totalSales FROM orders WHERE status IN ('Completed', 'Delivered') AND shopkeeper_id = ?",
        [shopkeeper_id]
      );

      // Get orders delivered count
      const [[deliveredData]] = await pool.execute(
        "SELECT COUNT(*) AS ordersDelivered FROM orders WHERE status IN ('Completed', 'Delivered') AND shopkeeper_id = ?",
        [shopkeeper_id]
      );

      // Get cancelled orders count
      const [[cancelledData]] = await pool.execute(
        "SELECT COUNT(*) AS cancelledOrders FROM orders WHERE status = 'Cancelled' AND shopkeeper_id = ?",
        [shopkeeper_id]
      );

      // Get top selling product
      const [[topProduct]] = await pool.execute(
        `
      SELECT p.id as productId, p.name, SUM(oi.quantity) AS unitsSold
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.shopkeeper_id = ? AND p.shop_id = ? AND o.status IN ('Completed', 'Delivered')
      GROUP BY p.id, p.name
      ORDER BY unitsSold DESC
      LIMIT 1
    `,
        [shopkeeper_id, shopkeeper_id]
      );

      // Check if home delivery is active (assuming a column exists or default to true)
      // If no column exists, we'll default to true
      let homeDeliveryActive = true;
      try {
        const [[deliveryStatus]] = await pool.execute(
          "SELECT home_delivery_active FROM shopkeepers WHERE id = ?",
          [shopkeeper_id]
        );
        if (
          deliveryStatus &&
          deliveryStatus.home_delivery_active !== undefined
        ) {
          homeDeliveryActive = Boolean(deliveryStatus.home_delivery_active);
        }
      } catch (err) {
        // Column doesn't exist, use default
        homeDeliveryActive = true;
      }

      res.json({
        success: true,
        data: {
          isOnline: Boolean(shopkeeper.is_online),
          homeDeliveryActive: homeDeliveryActive,
          totalSales: parseFloat(salesData?.totalSales || 0),
          ordersDelivered: parseInt(deliveredData?.ordersDelivered || 0),
          cancelledOrders: parseInt(cancelledData?.cancelledOrders || 0),
          topSelling: topProduct
            ? {
              productId: topProduct.productId,
              name: topProduct.name,
              unitsSold: parseInt(topProduct.unitsSold),
            }
            : null,
        },
      });
    } catch (err) {
      console.error("Dashboard summary error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// ============================================================================
// CUSTOMERS API
// ============================================================================
// GET /api/shopkeeper/customers - Get all customers who ordered from this shopkeeper
shopkeeperRouter.get(
  "/customers",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;
      const [customers] = await pool.execute(
        `SELECT DISTINCT u.id, u.name as username, u.email, u.phone, u.store_credits as credits, u.wallet, u.img 
         FROM users u 
         JOIN orders o ON u.id = o.user_id 
         WHERE o.shopkeeper_id = ?`,
        [shopkeeper_id]
      );
      res.json({ success: true, data: customers });
    } catch (err) {
      console.error("Fetch customers error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// PATCH /api/shopkeeper/customers/:id/credits - Update customer's store credits
shopkeeperRouter.patch(
  "/customers/:id/credits",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const customerId = req.params.id;
      const { credits } = req.body;
      const shopkeeper_id = req.user.id;
      
      // Verify the customer has ordered from this shopkeeper before allowing update
      const [validCustomer] = await pool.execute(
        `SELECT 1 FROM orders WHERE user_id = ? AND shopkeeper_id = ? LIMIT 1`,
        [customerId, shopkeeper_id]
      );
      
      if (validCustomer.length === 0) {
         return res.status(403).json({ success: false, message: "Not authorized to update this customer" });
      }

      await pool.execute(
        "UPDATE users SET store_credits = ? WHERE id = ?",
        [credits, customerId]
      );
      res.json({ success: true, message: "Credits updated successfully" });
    } catch (err) {
      console.error("Update credits error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// ============================================================================
// ANALYTICS API
// ============================================================================
shopkeeperRouter.get(
  "/analytics",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;
      const timeframe = req.query.timeframe || 'weekly';

      let dateFilter = '';
      let previousDateFilter = '';
      let groupBy = '';
      
      if (timeframe === 'daily') {
        dateFilter = 'AND o.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
        previousDateFilter = 'AND o.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) AND o.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)';
        groupBy = 'DATE(o.created_at)';
      } else if (timeframe === 'monthly') {
        dateFilter = 'AND o.created_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)';
        previousDateFilter = 'AND o.created_at >= DATE_SUB(NOW(), INTERVAL 2 MONTH) AND o.created_at < DATE_SUB(NOW(), INTERVAL 1 MONTH)';
        groupBy = 'WEEK(o.created_at)';
      } else { // weekly
        dateFilter = 'AND o.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
        previousDateFilter = 'AND o.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) AND o.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)';
        groupBy = 'DATE(o.created_at)';
      }

      // Total Sales & Pending Orders
      const [[currentStats]] = await pool.execute(
        `SELECT 
          SUM(CASE WHEN o.status IN ('Completed', 'Delivered') THEN o.total_amount ELSE 0 END) as totalSales,
          COUNT(CASE WHEN o.status = 'Pending' THEN 1 END) as pendingOrders,
          COUNT(CASE WHEN o.status IN ('Completed', 'Delivered') THEN 1 END) as completedCount,
          COUNT(*) as totalOrdersCount
         FROM orders o
         WHERE o.shopkeeper_id = ? ${dateFilter}`,
        [shopkeeper_id]
      );

      const [[previousStats]] = await pool.execute(
        `SELECT SUM(CASE WHEN o.status IN ('Completed', 'Delivered') THEN o.total_amount ELSE 0 END) as totalSales
         FROM orders o
         WHERE o.shopkeeper_id = ? ${previousDateFilter}`,
        [shopkeeper_id]
      );

      const totalSales = parseFloat(currentStats.totalSales || 0);
      const prevSales = parseFloat(previousStats.totalSales || 0);
      let growth = 0;
      if (prevSales > 0) {
        growth = ((totalSales - prevSales) / prevSales) * 100;
      }

      const receivedPct = currentStats.totalOrdersCount > 0
        ? (currentStats.completedCount / currentStats.totalOrdersCount) * 100
        : 0;

      // Low Stock Count
      const [[lowStock]] = await pool.execute(
        `SELECT COUNT(*) as count FROM products WHERE shop_id = ? AND (stock <= baselineQty OR stock <= 5)`,
        [shopkeeper_id]
      );

      // Chart Data
      const [chartRows] = await pool.execute(
        `SELECT ${groupBy} as day, SUM(o.total_amount) as revenue 
         FROM orders o
         WHERE o.shopkeeper_id = ? AND o.status IN ('Completed', 'Delivered') ${dateFilter}
         GROUP BY ${groupBy}`,
        [shopkeeper_id]
      );

      // Top Products
      const [topProducts] = await pool.execute(
        `SELECT p.id, p.name, SUM(oi.quantity) as sold
         FROM order_items oi
         JOIN orders o ON oi.order_id = o.id
         JOIN products p ON oi.product_id = p.id
         WHERE o.shopkeeper_id = ? AND p.shop_id = ? AND o.status IN ('Completed', 'Delivered') ${dateFilter}
         GROUP BY p.id, p.name
         ORDER BY sold DESC LIMIT 5`,
        [shopkeeper_id, shopkeeper_id]
      );

      // Top Customers
      const [topCustomers] = await pool.execute(
        `SELECT u.id, u.name, SUM(o.total_amount) as spent
         FROM orders o
         JOIN users u ON o.user_id = u.id
         WHERE o.shopkeeper_id = ? AND o.status IN ('Completed', 'Delivered') ${dateFilter}
         GROUP BY u.id, u.name
         ORDER BY spent DESC LIMIT 5`,
        [shopkeeper_id]
      );

      res.json({
        success: true,
        timeframe,
        totalSales,
        growth: parseFloat(growth.toFixed(1)),
        chartData: chartRows,
        receivedPct: parseFloat(receivedPct.toFixed(1)),
        pendingOrders: currentStats.pendingOrders || 0,
        lowStockCount: lowStock.count || 0,
        topProducts,
        topCustomers
      });

    } catch (err) {
      console.error("Analytics error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// ============================================================================
// ONLINE STATUS TOGGLE
// ============================================================================
// PATCH /api/shopkeeper/dashboard/online-status - Toggle shop online/offline
shopkeeperRouter.patch(
  "/dashboard/online-status",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;
      const { isOnline } = req.body;

      if (typeof isOnline !== "boolean") {
        return res
          .status(400)
          .json({ success: false, message: "isOnline must be a boolean" });
      }

      await pool.execute("UPDATE shopkeepers SET is_online = ? WHERE id = ?", [
        isOnline ? 1 : 0,
        shopkeeper_id,
      ]);

      res.json({
        success: true,
        message: `Shop is now ${isOnline ? "online" : "offline"}`,
        isOnline: isOnline,
      });
    } catch (err) {
      console.error("Online status toggle error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// ============================================================================
// HOME DELIVERY TOGGLE
// ============================================================================
// PATCH /api/shopkeeper/dashboard/home-delivery-status - Toggle home delivery
shopkeeperRouter.patch(
  "/dashboard/home-delivery-status",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;
      const { homeDeliveryActive } = req.body;

      if (typeof homeDeliveryActive !== "boolean") {
        return res.status(400).json({
          success: false,
          message: "homeDeliveryActive must be a boolean",
        });
      }

      // Check if column exists, if not, add it
      try {
        await pool.execute(
          "UPDATE shopkeepers SET home_delivery_active = ? WHERE id = ?",
          [homeDeliveryActive ? 1 : 0, shopkeeper_id]
        );
      } catch (updateErr) {
        // If column doesn't exist, try to add it
        if (updateErr.code === "ER_BAD_FIELD_ERROR") {
          try {
            await pool.execute(
              "ALTER TABLE shopkeepers ADD COLUMN home_delivery_active TINYINT(1) DEFAULT 1"
            );
            // Retry update
            await pool.execute(
              "UPDATE shopkeepers SET home_delivery_active = ? WHERE id = ?",
              [homeDeliveryActive ? 1 : 0, shopkeeper_id]
            );
          } catch (alterErr) {
            console.error(
              "Error adding home_delivery_active column:",
              alterErr
            );
            throw alterErr;
          }
        } else {
          throw updateErr;
        }
      }

      res.json({
        success: true,
        message: `Home delivery is now ${homeDeliveryActive ? "enabled" : "disabled"}`,
        homeDeliveryActive: homeDeliveryActive,
      });
    } catch (err) {
      console.error("Home delivery toggle error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// SHOPKEEPER SIGNUP - Handles both JSON and FormData
shopkeeperRouter.post("/signup", upload.single("img"), async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      shop_name,
      address,
      latitude,
      longitude,
    } = req.body;

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
        message: "Password must be at least 6 characters",
      });
    }

    // Check if shopkeeper already exists
    const [existingUser] = await pool.execute(
      "SELECT id FROM shopkeepers WHERE email = ?",
      [email]
    );

    if (existingUser.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Shopkeeper already exists",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Parse latitude and longitude if provided
    const lat = latitude ? parseFloat(latitude) : null;
    const lng = longitude ? parseFloat(longitude) : null;
    const addr = address && address.trim() ? address.trim() : null;

    // Handle optional image upload
    let imgUrl = null;
    if (req.file) {
      try {
        const streamifier = await import("streamifier");
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "shopkeepers" },
            (error, result) => {
              if (error) return reject(error);
              resolve(result);
            }
          );
          streamifier.default.createReadStream(req.file.buffer).pipe(stream);
        });
        imgUrl = result.secure_url;
      } catch (uploadErr) {
        console.error("Image upload error during signup:", uploadErr);
        // Continue without image - don't fail signup
      }
    }

    // WORKAROUND: Manual ID generation for TiDB Cloud
    // TiDB Cloud doesn't support AUTO_INCREMENT on existing columns
    // Generate ID manually until table is recreated with AUTO_RANDOM
    const [maxIdResult] = await pool.execute(
      "SELECT COALESCE(MAX(id), 0) as max_id FROM shopkeepers"
    );
    const nextId = maxIdResult[0].max_id + 1;

    console.log("Manually generating ID:", nextId);

    // Insert new shopkeeper with explicit ID
    const [result] = await pool.execute(
      `INSERT INTO shopkeepers (id, name, email, password, phone, shop_name, address, latitude, longitude, img) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nextId,
        name,
        email,
        hashedPassword,
        phone,
        shop_name,
        addr,
        lat,
        lng,
        imgUrl,
      ]
    );

    const newShopkeeperId = result.insertId || nextId;
    console.log("New shopkeeper created with ID:", newShopkeeperId);

    // Validate ID
    if (!newShopkeeperId || newShopkeeperId === 0) {
      console.error("❌ CRITICAL: Failed to generate valid ID");
      throw new Error(
        "Database configuration error: Failed to generate shopkeeper ID. Please contact support."
      );
    }

    // Get the created shopkeeper
    const [userRows] = await pool.execute(
      "SELECT id, name, email, phone, shop_name FROM shopkeepers WHERE id = ?",
      [newShopkeeperId]
    );

    console.log("User rows:", userRows);

    if (!userRows || userRows.length === 0) {
      throw new Error("Failed to retrieve created shopkeeper");
    }

    const user = userRows[0];

    // Generate JWE token
    const token = await createJWEToken(
      {
        id: user.id,
        role: "shopkeeper",
        email: user.email,
      },
      "7d"
    );

    return res.json({
      success: true,
      token,
      user,
      shopkeeper: user,
      message:
        "Shopkeeper registered successfully. Please wait for admin verification.",
    });
  } catch (err) {
    console.error("Shopkeeper signup error:", err);
    console.error("Error details:", {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlMessage: err.sqlMessage,
      sqlState: err.sqlState,
    });
    return res.status(500).json({
      success: false,
      message: "Server error",
      // Always include error details for debugging
      debug: {
        message: err.message,
        code: err.code,
        sqlMessage: err.sqlMessage,
      },
    });
  }
});

// SHOPKEEPER LOGIN
shopkeeperRouter.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Email and password are required" });
    }

    const [user] = await pool.execute(
      "SELECT * FROM shopkeepers WHERE email = ?",
      [email]
    );

    if (user.length === 0) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    // Check if account is soft deleted
    if (user[0].is_deleted === 1) {
      return res.status(403).json({
        success: false,
        message:
          "Your account has been deactivated. Please contact support for more information.",
        status: "deleted",
      });
    }

    const validPass = await bcrypt.compare(password, user[0].password);
    if (!validPass) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    // Check verification status with proper handling for all states
    const verificationStatus = user[0].is_verified;

    if (verificationStatus === 0) {
      // Rejected
      return res.status(403).json({
        success: false,
        message:
          "Your account has been denied. Please contact support for more information.",
        status: "rejected",
        verification_status: "rejected",
      });
    } else if (
      verificationStatus === null ||
      verificationStatus === "" ||
      verificationStatus === undefined
    ) {
      // Pending
      return res.status(403).json({
        success: false,
        message:
          "Your account is pending verification. Please wait for admin approval.",
        status: "pending",
        verification_status: "pending",
      });
    } else if (verificationStatus !== 1) {
      // Any other invalid status
      return res.status(403).json({
        success: false,
        message:
          "Your account verification status is unclear. Please contact support.",
        status: "unknown",
        verification_status: "unknown",
      });
    }

    // Only approved shopkeepers (is_verified = 1) can proceed

    // Defensive validation: Validate that user.id is not null before sending response
    if (!user[0].id || user[0].id === null || user[0].id === undefined) {
      console.error(
        "⚠️ CRITICAL: Shopkeeper signin succeeded but user.id is null!",
        {
          email: user[0].email,
          shopkeeperId: user[0].id,
        }
      );
      return res.status(500).json({
        success: false,
        message:
          "Database error: Shopkeeper ID not found. Please contact support.",
      });
    }

    const token = await createJWEToken(
      {
        id: user[0].id,
        role: "shopkeeper",
        email: user[0].email,
      },
      "7d"
    );

    // Response logging: Log complete response structure being sent
    console.log("✅ Shopkeeper signin successful:", {
      shopkeeperId: user[0].id,
      email: user[0].email,
      shopName: user[0].shop_name,
      tokenLength: token?.length || 0,
      tokenType: "JWE",
    });

    res.json({
      success: true,
      token,
      user: {
        id: user[0].id,
        email: user[0].email,
        name: user[0].name,
        shop_name: user[0].shop_name,
        is_verified: user[0].is_verified,
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
      return res.status(403).json({
        success: false,
        message: "Unauthorized: You can only access your own profile",
      });
    }

    const [user] = await pool.execute(
      "SELECT id, email, name, phone, address, shop_name, img, upi_id, upi_qr, latitude, longitude, expo_push_token, is_verified, is_deleted, created_at, home_delivery_active FROM shopkeepers WHERE id = ?",
      [requestedId]
    );

    if (user.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Shopkeeper not found" });
    }

    // Check if account is deleted
    if (user[0].is_deleted === 1) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated. Please contact support.",
      });
    }

    res.json({
      success: true,
      user: user[0],
      isComplete: !!(user[0].phone && user[0].address),
    });
  } catch (err) {
    console.error("Get profile error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// SHOPKEEPER UPDATE PROFILE - allow img and upi_qr upload, update expo_push_token and coords
shopkeeperRouter.put(
  "/profile/:id",
  verifyToken,
  upload.fields([
    { name: "img", maxCount: 1 },
    { name: "upi_qr", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const requestedId = parseInt(req.params.id);
      const authenticatedId = req.user.id;

      if (requestedId !== authenticatedId) {
        return res.status(403).json({
          success: false,
          message: "Unauthorized: You can only update your own profile",
        });
      }

      const {
        name,
        phone,
        address,
        shop_name,
        upi_id,
        expo_push_token,
        latitude,
        longitude,
      } = req.body;
      let imgUrl = null;
      let upiQrUrl = null;

      if (phone && !/^\d{10}$/.test(phone)) {
        return res
          .status(400)
          .json({ success: false, message: "Phone number must be 10 digits" });
      }

      // handle uploads
      try {
        const streamifier = await import("streamifier");

        if (req.files?.img && req.files.img[0]) {
          const file = req.files.img[0];
          const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              { folder: "shopkeepers" },
              (error, result) => {
                if (error) return reject(error);
                resolve(result);
              }
            );
            streamifier.default.createReadStream(file.buffer).pipe(stream);
          });
          imgUrl = result.secure_url;
        }

        if (req.files?.upi_qr && req.files.upi_qr[0]) {
          const file = req.files.upi_qr[0];
          const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              { folder: "shopkeepers/upi_qr" },
              (error, result) => {
                if (error) return reject(error);
                resolve(result);
              }
            );
            streamifier.default.createReadStream(file.buffer).pipe(stream);
          });
          upiQrUrl = result.secure_url;
        }
      } catch (uploadError) {
        console.error("Image upload error:", uploadError);
        return res
          .status(500)
          .json({ success: false, message: "Failed to upload image(s)" });
      }

      const fields = [];
      const values = [];

      if (name && name.trim()) {
        fields.push("name = ?");
        values.push(name.trim());
      }
      if (phone) {
        fields.push("phone = ?");
        values.push(phone);
      }
      if (address && address.trim()) {
        fields.push("address = ?");
        values.push(address.trim());
      }
      if (shop_name && shop_name.trim()) {
        fields.push("shop_name = ?");
        values.push(shop_name.trim());
      }
      if (upi_id !== undefined) {
        fields.push("upi_id = ?");
        values.push(upi_id || null);
      }
      if (expo_push_token !== undefined) {
        fields.push("expo_push_token = ?");
        values.push(expo_push_token || null);
      }
      if (latitude !== undefined) {
        fields.push("latitude = ?");
        values.push(latitude || null);
      }
      if (longitude !== undefined) {
        fields.push("longitude = ?");
        values.push(longitude || null);
      }
      if (imgUrl) {
        fields.push("img = ?");
        values.push(imgUrl);
      }
      if (upiQrUrl) {
        fields.push("upi_qr = ?");
        values.push(upiQrUrl);
      }

      if (fields.length === 0) {
        return res
          .status(400)
          .json({ success: false, message: "No valid fields to update" });
      }

      values.push(requestedId);
      const sql = `UPDATE shopkeepers SET ${fields.join(", ")} WHERE id = ?`;
      const [updateResult] = await pool.execute(sql, values);

      if (updateResult.affectedRows === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Shopkeeper not found" });
      }

      const [userRows] = await pool.execute(
        "SELECT id, name, email, phone, address, shop_name, img, upi_id, upi_qr, latitude, longitude, expo_push_token, is_verified, created_at, home_delivery_active FROM shopkeepers WHERE id = ?",
        [requestedId]
      );

      res.json({
        success: true,
        user: userRows[0],
        message: "Profile updated successfully",
      });
    } catch (err) {
      console.error("Update profile error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// SHOP ONLINE/OFFLINE STATUS TOGGLE
shopkeeperRouter.patch(
  "/shop-status",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;
      const { is_online } = req.body;

      // Validate input
      if (
        typeof is_online !== "boolean" &&
        is_online !== 0 &&
        is_online !== 1
      ) {
        return res.status(400).json({
          success: false,
          message: "is_online must be a boolean (true/false) or 0/1",
        });
      }

      const onlineStatus = is_online ? 1 : 0;

      const [result] = await pool.execute(
        "UPDATE shopkeepers SET is_online = ? WHERE id = ?",
        [onlineStatus, shopkeeper_id]
      );

      if (result.affectedRows === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Shopkeeper not found" });
      }

      res.json({
        success: true,
        is_online: onlineStatus === 1,
        message:
          onlineStatus === 1
            ? "Shop is now online and visible to customers"
            : "Shop is now offline and hidden from customers",
      });
    } catch (err) {
      console.error("Shop status toggle error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// GET SHOP STATUS
shopkeeperRouter.get("/shop-status", verifyToken, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;

    const [[shop]] = await pool.execute(
      "SELECT is_online FROM shopkeepers WHERE id = ?",
      [shopkeeper_id]
    );

    if (!shop) {
      return res
        .status(404)
        .json({ success: false, message: "Shopkeeper not found" });
    }

    res.json({
      success: true,
      is_online: shop.is_online === 1 || shop.is_online === null, // Default to online if null
    });
  } catch (err) {
    console.error("Get shop status error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * GET all orders for the logged-in shopkeeper
 * Supports filtering by status and delivery type
 */
shopkeeperRouter.get(
  "/orders",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;
      const { status, deliveryType } = req.query;

      let whereClause = "WHERE o.shopkeeper_id = ?";
      const params = [shopkeeper_id];

      // Filter by status if provided
      if (status && status !== "all") {
        if (status === "pending") {
          whereClause += " AND o.status = 'Pending'";
        } else if (status === "completed") {
          whereClause += " AND o.status = 'Completed'";
        } else if (status === "cancelled") {
          whereClause += " AND o.status = 'Cancelled'";
        }
      }

      // Filter by delivery type if provided
      if (deliveryType) {
        if (
          deliveryType === "click_and_collect" ||
          deliveryType === "store_pickup"
        ) {
          whereClause += " AND o.has_timer = 1";
        } else if (deliveryType === "home_delivery") {
          whereClause += " AND (o.has_timer = 0 OR o.has_timer IS NULL)";
        }
      }

      // Fetch orders with delivery type classification
      const [orderRows] = await pool.execute(
        `SELECT
        o.id AS order_id,
        o.user_id,
        o.shopkeeper_id,
        o.status,
        o.total_amount,
        o.credits_used,
        o.credits_earned,
        o.created_at,
        o.latitude,
        o.longitude,
        o.delivery_address,
        o.order_type,
        o.delivery_mode,
        o.scheduled_time,
        o.has_timer,
        o.pickup_code,
        o.timer_started_at,
        o.timer_expires_at,
        o.payment_method,
        CASE
          WHEN o.has_timer = 1 THEN 'click_and_collect'
          ELSE 'home_delivery'
        END as delivery_type,
        u.name AS customer_name,
        u.phone AS customer_phone,
        u.email AS customer_email
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       ${whereClause}
       ORDER BY o.created_at DESC`,
        params
      );

      // Fetch order items for all orders
      if (orderRows.length > 0) {
        const orderIds = orderRows.map((o) => o.order_id);
        const placeholders = orderIds.map(() => '?').join(',');
        const [itemRows] = await pool.execute(
          `SELECT
          oi.order_id,
          oi.product_id,
          COALESCE(p.name, 'Product Unavailable') AS product_name,
          p.image AS product_image,
          oi.quantity,
          oi.price
         FROM order_items oi
         LEFT JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id IN (${placeholders})`,
          orderIds
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
            price: item.price,
          });
        }

        // Compute delivery slots for home delivery orders
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

        // Attach items and computed fields to orders
        const orders = orderRows.map((order) => ({
          ...order,
          items: itemsByOrder[order.order_id] || [],
          deliverySlot:
            order.delivery_type === "home_delivery"
              ? computeDeliverySlot(order.created_at)
              : null,
          timerInfo:
            order.delivery_type === "click_and_collect"
              ? {
                hasTimer: order.has_timer === 1,
                pickupCode: order.pickup_code,
                timerStartedAt: order.timer_started_at,
                timerExpiresAt: order.timer_expires_at,
                isExpired: order.timer_expires_at
                  ? new Date() > new Date(order.timer_expires_at)
                  : false,
              }
              : null,
        }));

        return res.json({ success: true, orders });
      }

      res.json({ success: true, orders: [] });
    } catch (err) {
      console.error("Get shopkeeper orders error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

/**
 * PATCH /shopkeeper/orders/:id/status
 * Update order status (complete or cancel)
 */
shopkeeperRouter.patch(
  "/orders/:orderId/status",
  verifyToken,
  verifyShopkeeperStatus,
  checkSubscriptionStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;
      const { orderId } = req.params;
      let { status, cancellation_reason } = req.body;

      const orderIdNum = parseInt(orderId);
      if (isNaN(orderIdNum)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid order ID" });
      }

      const validStatuses = ["Pending", "Completed", "Cancelled"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid status. Must be one of: " + validStatuses.join(", "),
        });
      }

      if (status === "Cancelled") {
        if (!cancellation_reason || !cancellation_reason.trim()) {
          return res.status(400).json({
            success: false,
            message: "Cancellation reason is required when cancelling an order",
          });
        }
        cancellation_reason = cancellation_reason.trim().substring(0, 500);
      }

      const [orderCheck] = await pool.execute(
        "SELECT id FROM orders WHERE id = ? AND shopkeeper_id = ?",
        [orderIdNum, shopkeeper_id]
      );

      if (orderCheck.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found or not assigned to you",
        });
      }

      if (status === "Cancelled") {
        await pool.execute("START TRANSACTION");
        try {
          await pool.execute(
            "UPDATE orders SET status = 'Cancelled', cancellation_reason = ? WHERE id = ?",
            [cancellation_reason, orderIdNum]
          );

          await pool.execute(
            `
          UPDATE order_timers
          SET is_active = FALSE, stopped_at = NOW(), is_expired = FALSE
          WHERE order_id = ? AND is_active = TRUE
        `,
            [orderIdNum]
          );

          await restoreStockForCancelledOrder(
            orderIdNum,
            "shopkeeper",
            cancellation_reason || "Shopkeeper cancellation"
          );

          const [[orderData]] = await pool.execute(
            "SELECT credits_used, user_id FROM orders WHERE id = ?",
            [orderIdNum]
          );
          if (orderData?.credits_used > 0) {
            await pool.execute(
              "UPDATE users SET store_credits = COALESCE(store_credits, 0) + ? WHERE id = ?",
              [orderData.credits_used, orderData.user_id]
            );
          }

          await pool.execute("COMMIT");
        } catch (err) {
          await pool.execute("ROLLBACK");
          throw err;
        }
      } else if (status === "Completed") {
        await pool.execute(
          "UPDATE orders SET status = 'Completed' WHERE id = ?",
          [orderIdNum]
        );

        try {
          const [[orderDetails]] = await pool.execute(
            "SELECT user_id, created_at, timer_started_at, total_amount, order_type, delivery_mode FROM orders WHERE id = ?",
            [orderIdNum]
          );

          if (orderDetails) {
            const orderType =
              orderDetails.order_type || orderDetails.delivery_mode || "pickup";
            await awardWellnessPoints(
              pool,
              orderDetails.user_id,
              new Date(),
              orderDetails.timer_started_at || orderDetails.created_at,
              orderDetails.total_amount,
              orderType
            );
          }
        } catch (pointsErr) {
          console.error("Error awarding points:", pointsErr);
        }
      } else {
        await pool.execute("UPDATE orders SET status = ? WHERE id = ?", [
          status,
          orderIdNum,
        ]);
      }

      if (req.io) {
        const [[orderRow]] = await pool.execute(
          "SELECT user_id, shopkeeper_id, total_amount, has_timer FROM orders WHERE id = ?",
          [orderIdNum]
        );
        const payload = {
          orderId: orderIdNum,
          order_id: orderIdNum,
          status,
          updatedAt: new Date().toISOString(),
        };
        req.io
          .to(`shop_${orderRow?.shopkeeper_id}`)
          .emit("orderStatusUpdate", payload);
        req.io
          .to(`customer_${orderRow?.user_id}`)
          .emit("orderStatusUpdate", payload);
        req.io.to("admin").emit("orderStatusUpdate", payload);
      }

      const [[target]] = await pool.execute(
        "SELECT expo_push_token FROM users WHERE id = (SELECT user_id FROM orders WHERE id = ?)",
        [orderIdNum]
      );
      if (target?.expo_push_token) {
        await sendExpoPush(
          target.expo_push_token,
          `Order #${orderIdNum} Update`,
          `Your order status has been updated to ${status}.`,
          { orderId: orderIdNum, status }
        );
      }

      res.json({
        success: true,
        message: `Order status updated to ${status}`,
        status,
      });
    } catch (err) {
      console.error("Update order status error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

/**
 * GET all products of the logged-in shopkeeper
 */
shopkeeperRouter.get(
  "/products",
  verifyToken,
  verifyShopkeeperStatus,
  checkSubscriptionStatus,
  async (req, res) => {
    try {
      const shop_id = req.user.id;
      const [products] = await pool.execute(
        "SELECT * FROM products WHERE shop_id = ? ORDER BY created_at DESC",
        [shop_id]
      );
      res.json({ success: true, products });
    } catch (err) {
      console.error("Get products error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

/**
 * ADD new product
 */
shopkeeperRouter.post(
  "/products",
  verifyToken,
  verifyShopkeeperStatus,
  checkSubscriptionStatus,
  upload.single("image"),
  async (req, res) => {
    try {
      const shop_id = req.user.id;
      const { name, description, category, price, stock, baselineQty } =
        req.body;

      if (!name || price == null) {
        return res
          .status(400)
          .json({ success: false, message: "Name and price are required" });
      }

      const parsedPrice = Number(price);
      if (Number.isNaN(parsedPrice) || parsedPrice < 0)
        return res
          .status(400)
          .json({ success: false, message: "Invalid price" });

      // Handle baselineQty and stock logic:
      // 1. If baselineQty is provided, use it for both stock and baselineQty
      // 2. If baselineQty is not provided, use stock for both
      // 3. Default to 0 if neither provided
      let finalBaselineQty =
        baselineQty != null
          ? Number(baselineQty)
          : stock != null
            ? Number(stock)
            : 0;
      let finalStock = finalBaselineQty; // Always sync stock to baseline on creation

      if (Number.isNaN(finalBaselineQty) || finalBaselineQty < 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid stock or baseline quantity",
        });
      }

      // ✅ FIX: Ensure price is stored with exactly 2 decimal places
      const formattedPrice = parseFloat(parsedPrice.toFixed(2));

      // Handle optional image upload
      let imageUrl = null;
      if (req.file) {
        try {
          const streamifier = await import("streamifier");
          const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              { folder: "products" },
              (error, result) => {
                if (error) return reject(error);
                resolve(result);
              }
            );
            streamifier.default.createReadStream(req.file.buffer).pipe(stream);
          });
          imageUrl = result.secure_url;
        } catch (uploadErr) {
          console.error("Product image upload error:", uploadErr);
          return res
            .status(500)
            .json({ success: false, message: "Failed to upload image" });
        }
      }

      const [result] = await pool.execute(
        `INSERT INTO products (shop_id, name, description, category, price, stock, baselineQty, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          shop_id,
          name.trim(),
          description || null,
          category || null,
          formattedPrice,
          finalStock,
          finalBaselineQty,
          imageUrl,
        ]
      );

      const [created] = await pool.execute(
        "SELECT * FROM products WHERE id = ?",
        [result.insertId]
      );

      res.status(201).json({
        success: true,
        id: result.insertId,
        product: created[0],
        message: "Product added successfully",
      });
    } catch (err) {
      console.error("Add product error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

/**
 * BULK UPDATE baseline quantity for all products
 */
shopkeeperRouter.put(
  "/products/bulk/baseline",
  verifyToken,
  verifyShopkeeperStatus,
  checkSubscriptionStatus,
  async (req, res) => {
    try {
      const shop_id = req.user.id;
      const { baselineQty } = req.body;

      if (baselineQty == null) {
        return res.status(400).json({ success: false, message: "Baseline quantity is required" });
      }

      const b = Number(baselineQty);
      if (Number.isNaN(b) || b < 0) {
        return res.status(400).json({ success: false, message: "Invalid baseline quantity" });
      }

      const [result] = await pool.execute(
        "UPDATE products SET baselineQty = ?, stock = ? WHERE shop_id = ?",
        [b, b, shop_id]
      );

      res.json({
        success: true,
        message: `Successfully updated baseline quantity for ${result.affectedRows} products`,
        updatedCount: result.affectedRows,
        baselineQty: b
      });
    } catch (err) {
      console.error("Bulk update baseline error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

/**
 * UPDATE product
 */
shopkeeperRouter.put(
  "/products/:id",
  verifyToken,
  verifyShopkeeperStatus,
  checkSubscriptionStatus,
  upload.single("image"),
  async (req, res) => {
    try {
      const shop_id = req.user.id;
      const productId = req.params.id;
      const { name, description, category, price, stock, baselineQty } =
        req.body;

      const [existing] = await pool.execute(
        "SELECT * FROM products WHERE id = ? AND shop_id = ?",
        [productId, shop_id]
      );
      if (existing.length === 0)
        return res
          .status(404)
          .json({ success: false, message: "Product not found" });

      // Handle optional image upload
      let imageUrl = existing[0].image;
      if (req.file) {
        try {
          const streamifier = await import("streamifier");
          const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              { folder: "products" },
              (error, result) => {
                if (error) return reject(error);
                resolve(result);
              }
            );
            streamifier.default.createReadStream(req.file.buffer).pipe(stream);
          });
          imageUrl = result.secure_url;
        } catch (uploadErr) {
          console.error("Product image upload error:", uploadErr);
          return res
            .status(500)
            .json({ success: false, message: "Failed to upload image" });
        }
      }

      const fields = [];
      const values = [];
      if (name) {
        fields.push("name = ?");
        values.push(name.trim());
      }
      if (description !== undefined) {
        fields.push("description = ?");
        values.push(description || null);
      }
      if (category) {
        fields.push("category = ?");
        values.push(category);
      }
      if (price != null) {
        const p = Number(price);
        if (Number.isNaN(p) || p < 0)
          return res
            .status(400)
            .json({ success: false, message: "Invalid price" });
        // ✅ FIX: Ensure price is stored with exactly 2 decimal places
        const formattedPrice = parseFloat(p.toFixed(2));
        fields.push("price = ?");
        values.push(formattedPrice);
      }
      if (stock != null && baselineQty == null) {
        const s = Number(stock);
        if (Number.isNaN(s) || s < 0)
          return res
            .status(400)
            .json({ success: false, message: "Invalid stock" });
        fields.push("stock = ?");
        values.push(s);
      }

      // ✅ FIX: Add baselineQty handling - also set stock to match baseline
      if (baselineQty != null) {
        const b = Number(baselineQty);
        if (Number.isNaN(b) || b < 0)
          return res
            .status(400)
            .json({ success: false, message: "Invalid baseline quantity" });
        fields.push("baselineQty = ?");
        values.push(b);
        // When baseline is set or updated, always sync stock to it as per user requirement
        fields.push("stock = ?");
        values.push(b);
      }
      if (imageUrl !== existing[0].image) {
        fields.push("image = ?");
        values.push(imageUrl);
      }

      if (fields.length === 0)
        return res
          .status(400)
          .json({ success: false, message: "No fields to update" });

      values.push(productId, shop_id);
      await pool.execute(
        `UPDATE products SET ${fields.join(", ")} WHERE id = ? AND shop_id = ?`,
        values
      );

      const [updated] = await pool.execute(
        "SELECT * FROM products WHERE id = ? AND shop_id = ?",
        [productId, shop_id]
      );
      res.json({
        success: true,
        message: "Product updated successfully",
        product: updated[0],
      });
    } catch (err) {
      console.error("Update product error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

/**
 * DELETE product
 */
shopkeeperRouter.delete(
  "/products/:id",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shop_id = req.user.id;
      const productId = req.params.id;

      const [existing] = await pool.execute(
        "SELECT * FROM products WHERE id = ? AND shop_id = ?",
        [productId, shop_id]
      );
      if (existing.length === 0)
        return res
          .status(404)
          .json({ success: false, message: "Product not found" });

      // Check if product is referenced in any order_items
      const [usedInOrders] = await pool.execute(
        `SELECT COUNT(*) AS c FROM order_items WHERE product_id = ?`,
        [productId]
      );
      if (usedInOrders[0].c > 0)
        return res.status(400).json({
          success: false,
          message: "Cannot delete product involved in orders",
        });

      await pool.execute("DELETE FROM products WHERE id = ? AND shop_id = ?", [
        productId,
        shop_id,
      ]);
      res.json({ success: true, message: "Product deleted successfully" });
    } catch (err) {
      console.error("Delete product error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// --- Access global products (shopkeeper) ---
// List all global products (read-only for shopkeepers) filtered by shop scale
shopkeeperRouter.get(
  "/global-products",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      // Get shopkeeper's scale
      const [shopkeeper] = await pool.execute(
        "SELECT shop_scale FROM shopkeepers WHERE id = ?",
        [req.user.id]
      );

      if (shopkeeper.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Shopkeeper not found" });
      }

      const shopScale = shopkeeper[0].shop_scale || "small";

      // Get products available for this shop scale
      const [rows] = await pool.execute(
        `
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
    `,
        [JSON.stringify(shopScale)]
      );

      // Parse shop_scales for response - handle both JSON arrays and plain strings
      const products = rows.map((product) => {
        let shopScales = ["all"];
        if (product.shop_scales) {
          try {
            const parsed = JSON.parse(product.shop_scales);
            // Handle both array and plain string formats
            shopScales = Array.isArray(parsed) ? parsed : [parsed];
          } catch (error) {
            // Fallback: treat plain string as single-item array
            shopScales = [product.shop_scales];
          }
        }
        return {
          ...product,
          shopScales: shopScales,
        };
      });

      res.json({
        success: true,
        products: products,
        shopScale: shopScale,
      });
    } catch (err) {
      console.error("Get global products error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// Add a product into shopkeeper's catalog from global_products
// body: { global_product_id, price (optional override), baselineQty (required) }
shopkeeperRouter.post(
  "/products/from-global",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shop_id = req.user.id;
      const { global_product_id, price, baselineQty, stock } = req.body;

      if (!global_product_id) {
        return res
          .status(400)
          .json({ success: false, message: "global_product_id is required" });
      }

      // Handle baselineQty and stock logic:
      // 1. If baselineQty is provided, use it for both stock and baselineQty
      // 2. If baselineQty is not provided, use stock for both
      // 3. Default to 0 if neither provided
      let finalBaselineQty =
        baselineQty != null
          ? Number(baselineQty)
          : stock != null
            ? Number(stock)
            : 0;
      let finalStock = finalBaselineQty; // Always sync stock to baseline on creation

      if (Number.isNaN(finalBaselineQty) || finalBaselineQty < 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid stock or baseline quantity",
        });
      }

      // Verify global product exists
      const [gpRows] = await pool.execute(
        "SELECT * FROM global_products WHERE id = ?",
        [global_product_id]
      );
      if (gpRows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Global product not found" });
      }
      const gp = gpRows[0];

      // Prevent duplicate addition for same shop
      const [exists] = await pool.execute(
        "SELECT id FROM products WHERE shop_id = ? AND global_product_id = ?",
        [shop_id, global_product_id]
      );
      if (exists.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Product already added to your catalog",
        });
      }

      const priceToUse = price != null ? Number(price) : gp.price;
      if (Number.isNaN(priceToUse) || priceToUse < 0) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid price" });
      }

      // Set both stock and baselineQty to the same value
      const [result] = await pool.execute(
        `INSERT INTO products (shop_id, global_product_id, name, description, category, price, stock, baselineQty, image)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          shop_id,
          global_product_id,
          gp.name,
          gp.description || null,
          gp.category || null,
          priceToUse,
          finalStock,
          finalBaselineQty,
          gp.image || null,
        ]
      );

      const [created] = await pool.execute(
        "SELECT * FROM products WHERE id = ?",
        [result.insertId]
      );
      res.status(201).json({
        success: true,
        id: result.insertId,
        product: created[0],
        message: "Product added from global catalog",
      });
    } catch (err) {
      console.error("Add from global error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// Update only stock for a shopkeeper's product
shopkeeperRouter.patch(
  "/products/:id/stock",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shop_id = req.user.id;
      const productId = req.params.id;
      const { stock } = req.body;

      if (stock == null) {
        return res
          .status(400)
          .json({ success: false, message: "stock is required" });
      }
      const parsedStock = Number(stock);
      if (Number.isNaN(parsedStock) || parsedStock < 0) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid stock value" });
      }

      const [existing] = await pool.execute(
        "SELECT id FROM products WHERE id = ? AND shop_id = ?",
        [productId, shop_id]
      );
      if (existing.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Product not found" });
      }

      await pool.execute(
        "UPDATE products SET stock = ? WHERE id = ? AND shop_id = ?",
        [parsedStock, productId, shop_id]
      );
      const [updated] = await pool.execute(
        "SELECT * FROM products WHERE id = ? AND shop_id = ?",
        [productId, shop_id]
      );

      res.json({
        success: true,
        message: "Stock updated",
        product: updated[0],
      });
    } catch (err) {
      console.error("Update stock error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// Save expo push token for authenticated shopkeeper
shopkeeperRouter.post(
  "/push-token",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const { token } = req.body;
      if (!token)
        return res
          .status(400)
          .json({ success: false, message: "token is required" });

      await pool.execute(
        "UPDATE shopkeepers SET expo_push_token = ? WHERE id = ?",
        [token, req.user.id]
      );
      return res.json({ success: true, message: "Push token saved" });
    } catch (err) {
      console.error("Save shopkeeper push token error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// BILLING/SUBSCRIPTION ENDPOINTS - Shopkeeper pays admin for order access

// Get billing summary (amount due to admin)
shopkeeperRouter.get(
  "/earnings",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;

      // Get shopkeeper subscription info
      const [shopkeeper] = await pool.execute(
        `SELECT shop_scale, subscription_status, trial_ends_at, next_payment_due
       FROM shopkeepers WHERE id = ?`,
        [shopkeeper_id]
      );

      // Get total payments made by this shopkeeper
      const [payments] = await pool
        .query(
          `SELECT COALESCE(SUM(amount), 0) as total_paid
       FROM billing_payments
       WHERE shopkeeper_id = ? AND status = 'approved'`,
          [shopkeeper_id]
        )
        .catch(() => [[{ total_paid: 0 }]]);

      // Get pending payments
      const [pendingPayments] = await pool
        .query(
          `SELECT COALESCE(SUM(amount), 0) as pending_amount
       FROM billing_payments
       WHERE shopkeeper_id = ? AND status = 'pending'`,
          [shopkeeper_id]
        )
        .catch(() => [[{ pending_amount: 0 }]]);

      // Get order stats
      const [orderStats] = await pool.execute(
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
          subscription_status: shopData.subscription_status || "active",
          shop_scale: shopData.shop_scale || "small",
          trial_ends_at: shopData.trial_ends_at,
          next_payment_due: shopData.next_payment_due,
          total_orders: orderStats[0].total_orders,
          delivered_orders: orderStats[0].delivered_orders,
          total_sales: orderStats[0].total_sales,
        },
      });
    } catch (err) {
      console.error("Get billing summary error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// Get payment history (payments made to admin)
shopkeeperRouter.get(
  "/earnings/history",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;

      // Get payment history from billing_payments table
      const [payments] = await pool
        .query(
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
        )
        .catch(() => [[]]);

      res.json({
        success: true,
        data: payments,
      });
    } catch (err) {
      console.error("Get payment history error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// Get billing/subscription status
shopkeeperRouter.get(
  "/earnings/status",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;

      // Get shopkeeper subscription details
      const [shopkeeper] = await pool.execute(
        `SELECT shop_scale, subscription_status, trial_ends_at, next_payment_due, last_payment_date
       FROM shopkeepers WHERE id = ?`,
        [shopkeeper_id]
      );

      if (shopkeeper.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Shopkeeper not found" });
      }

      const data = shopkeeper[0];

      // Get this month's payment total
      const [monthPayments] = await pool
        .query(
          `SELECT COALESCE(SUM(amount), 0) as paid_this_month
       FROM billing_payments
       WHERE shopkeeper_id = ?
       AND status = 'approved'
       AND MONTH(payment_date) = MONTH(CURRENT_DATE())
       AND YEAR(payment_date) = YEAR(CURRENT_DATE())`,
          [shopkeeper_id]
        )
        .catch(() => [[{ paid_this_month: 0 }]]);

      res.json({
        success: true,
        data: {
          subscription_status: data.subscription_status || "active",
          shop_scale: data.shop_scale || "small",
          next_payment_due: data.next_payment_due,
          last_payment_date: data.last_payment_date,
          paid_this_month: monthPayments[0]?.paid_this_month || 0,
        },
      });
    } catch (err) {
      console.error("Get billing status error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// Update shop scale and auto-add matching global products
shopkeeperRouter.put("/update-scale/:id", verifyToken, async (req, res) => {
  try {
    const shopkeeperId = req.params.id;
    const { shop_scale } = req.body;

    if (!["small", "medium", "large"].includes(shop_scale)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop scale. Must be small, medium, or large",
      });
    }

    // No trial period - billing starts immediately

    const [result] = await pool.execute(
      "UPDATE shopkeepers SET shop_scale = ?, subscription_status = 'active' WHERE id = ?",
      [shop_scale, shopkeeperId]
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Shopkeeper not found" });
    }

    // Auto-add global products matching this scale to shopkeeper's products
    let productsAdded = 0;
    try {
      // Get global products available for this scale (matching scale or "all")
      const [globalProducts] = await pool.execute(
        `
        SELECT id, name, description, category, price, image
        FROM global_products
        WHERE JSON_CONTAINS(shop_scales, '"all"')
           OR JSON_CONTAINS(shop_scales, ?)
      `,
        [JSON.stringify(shop_scale)]
      );

      // Get existing products for this shopkeeper to avoid duplicates
      const [existingProducts] = await pool.execute(
        "SELECT global_product_id FROM products WHERE shop_id = ? AND global_product_id IS NOT NULL",
        [shopkeeperId]
      );
      const existingGlobalIds = new Set(
        existingProducts.map((p) => p.global_product_id)
      );

      // Add products that don't already exist
      for (const gp of globalProducts) {
        if (!existingGlobalIds.has(gp.id)) {
          await pool.execute(
            `INSERT INTO products (shop_id, global_product_id, name, description, category, price, stock, image)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              shopkeeperId,
              gp.id,
              gp.name,
              gp.description || null,
              gp.category || null,
              gp.price || 0,
              0,
              gp.image || null,
            ]
          );
          productsAdded++;
        }
      }

      console.log(
        `Auto-added ${productsAdded} products for shopkeeper ${shopkeeperId} with scale ${shop_scale}`
      );
    } catch (productErr) {
      console.error("Error auto-adding products:", productErr);
      // Don't fail the whole request if product addition fails
    }

    res.json({
      success: true,
      message: `Shop scale updated to ${shop_scale}`,
      products_added: productsAdded,
    });
  } catch (err) {
    console.error("Update shop scale error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
});

// Get subscription status
shopkeeperRouter.get("/subscription-status", verifyToken, async (req, res) => {
  try {
    const [shopkeeper] = await pool.execute(
      "SELECT shop_scale, subscription_status, last_payment_date, next_payment_due, grace_period_end FROM shopkeepers WHERE id = ?",
      [req.user.id]
    );

    if (shopkeeper.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Shopkeeper not found" });
    }

    const data = shopkeeper[0];
    const now = new Date();

    // Calculate grace days remaining if in grace period
    let graceDaysRemaining = 0;
    if (data.grace_period_end) {
      const gracePeriodEnd = new Date(data.grace_period_end);
      graceDaysRemaining = Math.ceil(
        (gracePeriodEnd - now) / (1000 * 60 * 60 * 24)
      );
      graceDaysRemaining = graceDaysRemaining > 0 ? graceDaysRemaining : 0;
    }

    // Calculate days until payment due
    let daysUntilDue = 0;
    if (data.next_payment_due) {
      const nextPaymentDue = new Date(data.next_payment_due);
      daysUntilDue = Math.ceil((nextPaymentDue - now) / (1000 * 60 * 60 * 24));
    }

    res.json({
      success: true,
      data: {
        ...data,
        subscription_status: data.subscription_status || "active",
        graceDaysRemaining,
        daysUntilDue,
        is_trial_active: false,
        can_access: data.subscription_status !== "suspended",
      },
    });
  } catch (err) {
    console.error("Get subscription status error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Submit payment
shopkeeperRouter.post("/submit-payment", verifyToken, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    const { amount, payment_method, transaction_id } = req.body;

    // Validate amount
    if (!amount || amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Valid amount is required" });
    }

    // Insert payment request
    const [result] = await pool.execute(
      `INSERT INTO billing_payments (shopkeeper_id, amount, payment_method, transaction_id, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [shopkeeper_id, amount, payment_method || "upi", transaction_id || null]
    );

    res.json({
      success: true,
      message: "Payment submitted successfully. Waiting for admin approval.",
      payment_id: result.insertId,
    });
  } catch (err) {
    console.error("Submit payment error:", err);

    // Provide more specific error messages
    if (err.code === "ER_NO_SUCH_TABLE") {
      return res.status(500).json({
        success: false,
        error: "Database table not found. Please contact support.",
      });
    }

    if (err.code === "ER_BAD_FIELD_ERROR") {
      return res.status(500).json({
        success: false,
        error: "Database schema mismatch. Please contact support.",
      });
    }

    res.status(500).json({
      success: false,
      error: err.message || "Failed to submit payment. Please try again.",
    });
  }
});

// Get payment history
shopkeeperRouter.get("/payment-history", verifyToken, async (req, res) => {
  try {
    const [payments] = await pool.execute(
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
    const [tables] = await pool.execute(`
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('order_timers')
    `);
    return tables.length > 0;
  } catch (err) {
    return false;
  }
};

// Start timer for an order (when order is ready for pickup)
shopkeeperRouter.post(
  "/orders/:orderId/start-timer",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;
      const { orderId } = req.params;
      const { timer_duration = 420 } = req.body; // Default 7 minutes

      const orderIdNum = parseInt(orderId);
      if (isNaN(orderIdNum)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid order ID" });
      }

      // Check if timer tables exist
      const timerTablesExist = await checkTimerTablesExist();
      if (!timerTablesExist) {
        return res.status(503).json({
          success: false,
          message:
            "Timer system not initialized. Please run: npm run init-timer-safe",
        });
      }

      // Check if order belongs to this shopkeeper and is in correct status
      const [orderCheck] = await pool.execute(
        "SELECT id, status FROM orders WHERE id = ? AND shopkeeper_id = ?",
        [orderIdNum, shopkeeper_id]
      );

      if (orderCheck.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found or not assigned to you",
        });
      }

      if (orderCheck[0].status !== "Pending") {
        return res.status(400).json({
          success: false,
          message: "Timer can only be started for pending orders",
        });
      }

      // Generate 6-digit pickup code
      const pickupCode = Math.floor(100000 + Math.random() * 900000).toString();

      // Calculate timer expiry
      const timerStarted = new Date();
      const timerExpires = new Date(
        timerStarted.getTime() + timer_duration * 1000
      );

      // Create or update timer record
      try {
        await pool.execute(
          `
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
      `,
          [orderIdNum, pickupCode, timer_duration, timerStarted, timerExpires]
        );
      } catch (timerError) {
        console.error("Timer record creation failed:", timerError);
        // Continue without timer record if table doesn't exist
      }

      // Update orders table
      await pool.execute(
        `
      UPDATE orders
      SET has_timer = TRUE, pickup_code = ?, timer_started_at = ?, timer_expires_at = ?
      WHERE id = ?
    `,
        [pickupCode, timerStarted, timerExpires, orderIdNum]
      );

      // Broadcast timer started event
      if (req.io) {
        req.io.to(`shop_${shopkeeper_id}`).emit("timerStarted", {
          orderId: orderIdNum,
          pickupCode,
          timerDuration: timer_duration,
          expiresAt: timerExpires,
        });
      }

      res.json({
        success: true,
        message: "Timer started successfully",
        pickup_code: pickupCode,
        timer_duration: timer_duration,
        expires_at: timerExpires,
      });
    } catch (err) {
      console.error("Start timer error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// Verify pickup code - stops timer and marks order as Completed
// This is called when customer arrives at shop and gives the code to shopkeeper
shopkeeperRouter.post(
  "/orders/:orderId/verify-pickup",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;
      const { orderId } = req.params;
      const { pickup_code } = req.body;

      console.log(
        `Verify pickup: shopkeeper=${shopkeeper_id}, order=${orderId}, code=${pickup_code}`
      );

      const orderIdNum = parseInt(orderId);
      if (isNaN(orderIdNum)) {
        console.error("Invalid order ID:", orderId);
        return res
          .status(400)
          .json({ success: false, message: "Invalid order ID" });
      }

      if (!pickup_code) {
        console.error("Pickup code missing in request body");
        return res
          .status(400)
          .json({ success: false, message: "Pickup code is required" });
      }

      console.log(`📥 Received verify-pickup request: orderId=${orderIdNum}, pickup_code="${pickup_code}" (type=${typeof pickup_code}, length=${pickup_code?.length})`);

      // Get order info (without timer table join to avoid errors if table doesn't exist)
      let orderInfo;
      try {
        [orderInfo] = await pool.execute(
          `
        SELECT o.id, o.status, o.pickup_code, o.user_id, o.created_at, o.timer_started_at, o.timer_expires_at, o.total_amount, o.order_type, o.delivery_mode
        FROM orders o
        WHERE o.id = ? AND o.shopkeeper_id = ?
      `,
          [orderIdNum, shopkeeper_id]
        );
      } catch (queryError) {
        console.error("Order query error:", queryError);
        return res.status(500).json({
          success: false,
          message: "Database error: " + queryError.message,
        });
      }

      if (orderInfo.length === 0) {
        console.error(
          `Order ${orderIdNum} not found for shopkeeper ${shopkeeper_id}`
        );
        return res.status(404).json({
          success: false,
          message: "Order not found or not assigned to you",
        });
      }

      const order = orderInfo[0];
      console.log(
        `Order found: status=${order.status}, pickup_code="${order.pickup_code}" (type=${typeof order.pickup_code}, length=${order.pickup_code?.length})`
      );
      console.log(
        `Received pickup_code from request: "${pickup_code}" (type=${typeof pickup_code}, length=${pickup_code?.length})`
      );

      // Check if order has a pickup code
      if (!order.pickup_code) {
        console.error(`Order ${orderIdNum} has no pickup code in database`);
        return res.status(400).json({
          success: false,
          message: "This order does not have a pickup code. It may be a delivery order.",
        });
      }

      // Check if order is already completed
      if (order.status === "Completed") {
        console.warn(`Order ${orderIdNum} already completed`);
        return res.status(400).json({
          success: false,
          message: "Order is already completed",
        });
      }

      // Verify pickup code (ensure both are strings for comparison)
      const expectedCode = String(order.pickup_code || '').trim();
      const providedCode = String(pickup_code || '').trim();

      if (expectedCode !== providedCode) {
        console.error(
          `Invalid pickup code: expected="${expectedCode}" (type=${typeof order.pickup_code}), got="${providedCode}" (type=${typeof pickup_code})`
        );
        return res.status(400).json({
          success: false,
          message: "Invalid pickup code. Please check and try again.",
        });
      }

      const now = new Date();
      const timerExpiresAt = order.timer_expires_at;
      // Check if customer arrived on time
      const wasOnTime = timerExpiresAt && now <= new Date(timerExpiresAt);
      console.log(
        `Timer check: expires=${timerExpiresAt}, now=${now}, wasOnTime=${wasOnTime}`
      );

      // ✅ FIX: Use atomic update to prevent race condition
      // Mark order as Completed for any status except Completed or Cancelled
      // This prevents duplicate reward awards from concurrent requests
      try {
        const [updateResult] = await pool.execute(
          `
          UPDATE orders
          -- Do NOT clear has_timer here: preserving has_timer/delivery_type keeps
          -- pickup orders correctly classified in consuming clients (shopkeeper app)
          SET status = 'Completed'
          WHERE id = ? AND status NOT IN ('Completed', 'Cancelled')
        `,
          [orderIdNum]
        );

        if (updateResult.affectedRows === 0) {
          // Order was already completed or cancelled
          console.warn(
            `Order ${orderIdNum} already completed or cancelled`
          );
          return res.status(400).json({
            success: false,
            message:
              "Order is already completed or cancelled and cannot be completed",
          });
        }

        console.log(`Order ${orderIdNum} marked as Completed (atomic update)`);
      } catch (updateError) {
        console.error("Order update error:", updateError);
        return res.status(500).json({
          success: false,
          message: "Failed to update order: " + updateError.message,
        });
      }

      // Stop timer in order_timers table (create record if it doesn't exist)
      try {
        // First, try to update existing record
        const [timerUpdateResult] = await pool.execute(
          `
        UPDATE order_timers
        SET is_active = FALSE, stopped_at = ?, is_expired = ?
        WHERE order_id = ?
      `,
          [now, !wasOnTime, orderIdNum]
        );

        // If no record was updated, create one
        if (timerUpdateResult.affectedRows === 0) {
          console.log("No timer record found, creating one...");
          await pool.execute(
            `
          INSERT INTO order_timers (order_id, pickup_code, timer_duration, timer_started_at, timer_expires_at, is_active, is_expired, stopped_at)
          VALUES (?, ?, 420, ?, ?, FALSE, ?, ?)
        `,
            [
              orderIdNum,
              order.pickup_code,
              order.timer_started_at || order.created_at,
              order.timer_expires_at,
              !wasOnTime,
              now,
            ]
          );
          console.log("Timer record created and stopped");
        } else {
          console.log("Timer record updated successfully");
        }
      } catch (timerError) {
        console.warn("Timer update failed:", timerError.message);
        // Continue - this is not critical for order completion
      }

      // Award wellness points based on timing
      // Pickup orders: Timer-based credits (40, 30, 10, or 5 points)
      // Home delivery orders: Fixed 40 points maximum
      let pointsAwarded = 0;
      try {
        const orderType = order.order_type || order.delivery_mode || "pickup";
        const isHomeDelivery =
          orderType === "delivery" || orderType === "home_delivery";

        // Award credits for both pickup and home delivery
        const pointsData = await awardWellnessPoints(
          pool,
          order.user_id,
          now, // completion time
          order.timer_started_at || order.created_at, // timer start time
          order.total_amount, // Pass order amount for minimum check
          orderType // Pass delivery type for home delivery capping
        );
        pointsAwarded = pointsData.points;
        console.log(
          `Awarded ${pointsAwarded} wellness points to user ${order.user_id} for ${isHomeDelivery ? "home delivery" : "pickup"} order ${orderIdNum}`
        );
      } catch (pointsError) {
        console.error("Error awarding wellness points:", pointsError);
        // Continue - points are not critical
      }

      // Broadcast events via socket
      console.log(`📡 Socket: Checking req.io availability...`);
      console.log(`📡 Socket: req.io exists: ${!!req.io}`);
      console.log(`📡 Socket: req.io type: ${typeof req.io}`);

      if (req.io) {
        // Convert to numbers to ensure consistent room names
        const shopRoom = `shop_${Number(shopkeeper_id)}`;
        const customerRoom = `customer_${Number(order.user_id)}`;

        console.log(
          `📡 Socket: Emitting events to rooms: ${shopRoom} and ${customerRoom}`
        );
        console.log(
          `📡 Socket: Order ${orderIdNum} - status=Completed, wasOnTime=${wasOnTime}, points=${pointsAwarded}`
        );

        const socketPayload = {
          orderId: orderIdNum,
          order_id: orderIdNum, // Add for compatibility
          status: "Completed",
          originalStatus: "Completed",
          wasOnTime,
          was_on_time: wasOnTime, // Add for compatibility
          timerStopped: true,
          timer_stopped: true, // Add for compatibility
          stoppedAt: now.toISOString(),
          stopped_at: now.toISOString(), // Add for compatibility
          pointsAwarded,
          points_awarded: pointsAwarded, // Add for compatibility
          userId: order.user_id,
          user_id: order.user_id, // Add for compatibility
          shopkeeperId: shopkeeper_id,
          shopkeeper_id: shopkeeper_id, // Add for compatibility
          totalAmount: parseFloat(order.total_amount),
          total_amount: parseFloat(order.total_amount), // Add for compatibility
          pickupCode: order.pickup_code,
          pickup_code: order.pickup_code, // Add for compatibility
          updatedAt: now.toISOString(),
          updated_at: now.toISOString(), // Add for compatibility
        };

        // Emit orderStatusUpdate to both rooms
        req.io.to(shopRoom).emit("orderStatusUpdate", socketPayload);
        req.io.to(customerRoom).emit("orderStatusUpdate", socketPayload);

        // Also emit to admin room
        req.io.to("admin").emit("orderStatusUpdate", socketPayload);

        // Emit specific timerStopped event to both rooms
        const timerStoppedPayload = {
          orderId: orderIdNum,
          order_id: orderIdNum, // Add for compatibility
          stoppedAt: now.toISOString(),
          stopped_at: now.toISOString(), // Add for compatibility
          wasOnTime,
          was_on_time: wasOnTime, // Add for compatibility
          pointsAwarded,
          points_awarded: pointsAwarded, // Add for compatibility
          userId: order.user_id,
          user_id: order.user_id, // Add for compatibility
          shopkeeperId: shopkeeper_id,
          shopkeeper_id: shopkeeper_id, // Add for compatibility
        };
        req.io.to(shopRoom).emit("timerStopped", timerStoppedPayload);
        req.io.to(customerRoom).emit("timerStopped", timerStoppedPayload);
        req.io.to("admin").emit("timerStopped", timerStoppedPayload);

        console.log(`📡 Socket: Events emitted successfully`);
        console.log(
          `📡 Socket: orderStatusUpdate payload:`,
          JSON.stringify(socketPayload)
        );
        console.log(
          `📡 Socket: timerStopped payload:`,
          JSON.stringify(timerStoppedPayload)
        );
      } else {
        console.warn(
          "📡 Socket: req.io is not available - socket events not sent!"
        );
      }

      // Send push notification to customer
      try {
        const [[customer]] = await pool.execute(
          `SELECT expo_push_token FROM users WHERE id = ?`,
          [order.user_id]
        );

        if (customer?.expo_push_token) {
          const message = wasOnTime
            ? `🎉 Order completed on time! You earned ${pointsAwarded} Store credits.`
            : `📦 Order completed! You earned ${pointsAwarded} Store credits (reduced due to late arrival).`;

          const token = customer.expo_push_token;
          if (isFCMToken(token)) {
            await sendFCMPush(token, "Order Completed!", message, {
              orderId: String(orderIdNum),
              status: "Completed",
              wasOnTime: String(wasOnTime),
            });
          } else {
            await sendExpoPush(token, "Order Completed!", message, {
              orderId: orderIdNum,
              status: "Completed",
              wasOnTime,
            });
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
        points_awarded: pointsAwarded,
        timer_stopped: true,
        stopped_at: now.toISOString(),
        order_status: "Completed",
      });
    } catch (err) {
      console.error("=== VERIFY PICKUP ERROR ===");
      console.error("Error message:", err.message);
      console.error("Error stack:", err.stack);
      console.error("Error name:", err.name);
      console.error(
        "Full error:",
        JSON.stringify(err, Object.getOwnPropertyNames(err))
      );
      console.error("=========================");
      res
        .status(500)
        .json({ success: false, message: `Server error: ${err.message}` });
    }
  }
);

// Legacy endpoint - redirects to verify-pickup
shopkeeperRouter.post(
  "/orders/:orderId/stop-timer",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    // Forward to verify-pickup endpoint
    req.url = req.url.replace("stop-timer", "verify-pickup");
    return shopkeeperRouter.handle(req, res);
  }
);

// Get timer status for an order
shopkeeperRouter.get(
  "/orders/:orderId/timer",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;
      const { orderId } = req.params;

      const orderIdNum = parseInt(orderId);
      if (isNaN(orderIdNum)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid order ID" });
      }

      // Get timer info
      const [timerInfo] = await pool.execute(
        `
      SELECT o.id, o.pickup_code, o.has_timer, o.timer_started_at, o.timer_expires_at,
             ot.timer_duration, ot.is_active, ot.is_expired, ot.stopped_at
      FROM orders o
      LEFT JOIN order_timers ot ON o.id = ot.order_id
      WHERE o.id = ? AND o.shopkeeper_id = ?
    `,
        [orderIdNum, shopkeeper_id]
      );

      if (timerInfo.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found or not assigned to you",
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
          await pool.execute(
            `
          UPDATE order_timers
          SET is_active = FALSE, is_expired = TRUE
          WHERE order_id = ?
        `,
            [orderIdNum]
          );

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
          stopped_at: timer.stopped_at,
        },
      });
    } catch (err) {
      console.error("Get timer error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// Force refresh timer status - useful for frontend debugging
shopkeeperRouter.get(
  "/orders/:orderId/timer/refresh",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;
      const { orderId } = req.params;

      const orderIdNum = parseInt(orderId);
      if (isNaN(orderIdNum)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid order ID" });
      }

      console.log(`🔄 Force refreshing timer status for order ${orderIdNum}`);

      // Get complete order and timer info
      const [orderInfo] = await pool.execute(
        `
      SELECT o.id, o.status, o.has_timer, o.pickup_code, o.timer_started_at, o.timer_expires_at,
             ot.timer_duration, ot.is_active, ot.is_expired, ot.stopped_at,
             o.user_id, o.shopkeeper_id
      FROM orders o
      LEFT JOIN order_timers ot ON o.id = ot.order_id
      WHERE o.id = ? AND o.shopkeeper_id = ?
    `,
        [orderIdNum, shopkeeper_id]
      );

      if (orderInfo.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found or not assigned to you",
        });
      }

      const order = orderInfo[0];
      let timeLeft = 0;

      if (order.is_active && order.timer_expires_at) {
        const now = new Date();
        const expiresAt = new Date(order.timer_expires_at);
        timeLeft = Math.max(0, Math.floor((expiresAt - now) / 1000));
      }

      const response = {
        success: true,
        order: {
          id: order.id,
          status: order.status,
          has_timer: order.has_timer,
          pickup_code: order.pickup_code,
        },
        timer: {
          has_timer: order.has_timer,
          pickup_code: order.pickup_code,
          is_active: order.is_active,
          is_expired: order.is_expired,
          time_left: timeLeft,
          timer_duration: order.timer_duration,
          started_at: order.timer_started_at,
          expires_at: order.timer_expires_at,
          stopped_at: order.stopped_at,
        },
        debug_info: {
          order_status: order.status,
          timer_stopped: !!order.stopped_at,
          timer_active: order.is_active,
          current_time: new Date().toISOString(),
        },
      };

      console.log(
        `🔄 Timer refresh response for order ${orderIdNum}:`,
        JSON.stringify(response, null, 2)
      );

      // If timer is stopped, emit socket events again to ensure frontend receives them
      if (order.stopped_at && order.status === "Completed") {
        console.log(
          `📡 Re-emitting timer stopped events for order ${orderIdNum}`
        );

        if (req.io) {
          const shopRoom = `shop_${Number(shopkeeper_id)}`;
          const customerRoom = `customer_${Number(order.user_id)}`;

          const socketPayload = {
            orderId: orderIdNum,
            status: "Completed",
            timerStopped: true,
            stoppedAt: order.stopped_at,
            refreshed: true,
          };

          req.io.to(shopRoom).emit("orderStatusUpdate", socketPayload);
          req.io.to(customerRoom).emit("orderStatusUpdate", socketPayload);

          req.io.to(shopRoom).emit("timerStopped", {
            orderId: orderIdNum,
            stoppedAt: order.stopped_at,
            refreshed: true,
          });
          req.io.to(customerRoom).emit("timerStopped", {
            orderId: orderIdNum,
            stoppedAt: order.stopped_at,
            refreshed: true,
          });

          console.log(
            `📡 Re-emitted events to ${shopRoom} and ${customerRoom}`
          );
        }
      }

      res.json(response);
    } catch (err) {
      console.error("Timer refresh error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// Cleanup expired timers (can be called periodically)
shopkeeperRouter.post(
  "/cleanup-expired-timers",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const now = new Date();

      // Find and expire active timers that have passed their expiry time
      const [expiredTimers] = await pool.execute(
        `
      SELECT ot.order_id
      FROM order_timers ot
      WHERE ot.is_active = TRUE AND ot.timer_expires_at < ?
    `,
        [now]
      );

      if (expiredTimers.length > 0) {
        const orderIds = expiredTimers.map((t) => t.order_id);

        // Mark timers as expired and inactive (removes from active timer list)
        // But order remains visible and can still be completed via code/QR or cancelled
        await pool.execute(
          `
        UPDATE order_timers
        SET is_active = FALSE, is_expired = TRUE
        WHERE order_id IN (${orderIds.map(() => "?").join(",")})
      `,
          orderIds
        );

        // Broadcast timerExpired events for UI indication
        if (req.io) {
          const placeholders = orderIds.map(() => "?").join(",");
          const [orders] = await pool.execute(
            `SELECT id, user_id, shopkeeper_id, pickup_code, timer_started_at, timer_expires_at
           FROM orders
           WHERE id IN (${placeholders})`,
            orderIds
          );
          for (const o of orders) {
            const payload = {
              orderId: o.id,
              userId: o.user_id,
              shopkeeperId: o.shopkeeper_id,
              pickupCode: o.pickup_code,
              timerStartedAt: o.timer_started_at,
              timerExpiresAt: o.timer_expires_at,
              expiredAt: new Date().toISOString(),
            };
            const shopRoom = `shop_${Number(o.shopkeeper_id)}`;
            const customerRoom = `customer_${Number(o.user_id)}`;
            req.io.to(shopRoom).emit("timerExpired", payload);
            req.io.to(customerRoom).emit("timerExpired", payload);
            req.io.to("admin").emit("timerExpired", payload);
          }
        }

        console.log(
          `Expired ${expiredTimers.length} timers (kept visible for code/QR verification)`
        );
      }

      res.json({
        success: true,
        message: `Cleaned up ${expiredTimers.length} expired timers`,
      });
    } catch (err) {
      console.error("Cleanup timers error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// ==================== LOCATION VERIFICATION SYSTEM ====================

// Verify shopkeeper location
shopkeeperRouter.post(
  "/verify-location",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;
      const { latitude, longitude } = req.body;

      if (!latitude || !longitude) {
        return res.status(400).json({
          success: false,
          message: "Latitude and longitude are required",
        });
      }

      // Get shopkeeper's registered location
      const [shopkeeper] = await pool.execute(
        "SELECT latitude, longitude, address FROM shopkeepers WHERE id = ?",
        [shopkeeper_id]
      );

      if (shopkeeper.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Shopkeeper not found",
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
          message:
            "Location not registered. Please register your shop location.",
        });
      }

      // Calculate distance using Haversine formula
      const R = 6371e3; // Earth's radius in meters
      const φ1 = (registeredLat * Math.PI) / 180;
      const φ2 = (latitude * Math.PI) / 180;
      const Δφ = ((latitude - registeredLat) * Math.PI) / 180;
      const Δλ = ((longitude - registeredLon) * Math.PI) / 180;

      const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c; // Distance in meters

      const tolerance = 50; // 50 meters tolerance
      const verified = distance <= tolerance;

      // Log location verification attempt
      await pool.execute(
        `
      INSERT INTO location_verifications (shopkeeper_id, latitude, longitude, distance, verified, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `,
        [shopkeeper_id, latitude, longitude, Math.round(distance), verified]
      );

      res.json({
        success: true,
        verified: verified,
        distance: Math.round(distance),
        tolerance: tolerance,
        message: verified
          ? "Location verified successfully"
          : `You are ${Math.round(distance)}m away from your registered location`,
      });
    } catch (err) {
      console.error("Location verification error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// Get location verification history
shopkeeperRouter.get(
  "/location-history",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;

      const [history] = await pool.execute(
        `
      SELECT latitude, longitude, distance, verified, created_at
      FROM location_verifications
      WHERE shopkeeper_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `,
        [shopkeeper_id]
      );

      res.json({
        success: true,
        history: history,
      });
    } catch (err) {
      console.error("Location history error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// GET /api/shopkeeper/payment-info - Get admin payment credentials for payment requests
shopkeeperRouter.get(
  "/payment-info",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      // Get admin payment information for shopkeepers to see where to send payments
      const [rows] = await pool
        .query(
          "SELECT upi_id, bank_account, bank_name, ifsc_code, account_holder, qr_code FROM payment_info WHERE type = 'admin' LIMIT 1"
        )
        .catch(() => [[]]);

      if (rows.length === 0) {
        // Return default structure if no payment info is set
        return res.json({
          success: true,
          data: {
            upi_id: "",
            bank_account: "",
            bank_name: "",
            ifsc_code: "",
            account_holder: "NexKirana Admin",
            qr_code: null,
          },
        });
      }

      res.json({
        success: true,
        data: rows[0],
      });
    } catch (err) {
      console.error("Shopkeeper payment info fetch error:", err);
      res.status(500).json({
        success: false,
        message: "Server error",
        error: err.message,
      });
    }
  }
);

// GET /api/shopkeeper/subscription - Get detailed subscription status
shopkeeperRouter.get("/subscription", verifyToken, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    const statusInfo = await calculateSubscriptionStatus(shopkeeper_id);

    res.json({
      success: true,
      subscription: statusInfo,
    });
  } catch (err) {
    console.error("Subscription status error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to get subscription status",
      error: err.message,
    });
  }
});

// POST /api/shopkeeper/subscription/check-access - Check if shopkeeper can access app
shopkeeperRouter.post(
  "/subscription/check-access",
  verifyToken,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;
      const canAccess = await canAccessApp(shopkeeper_id);
      const statusInfo = await calculateSubscriptionStatus(shopkeeper_id);

      res.json({
        success: true,
        canAccess,
        subscription: statusInfo,
      });
    } catch (err) {
      console.error("Subscription access check error:", err);
      res.status(500).json({
        success: false,
        message: "Failed to check access",
        error: err.message,
      });
    }
  }
);

// ========================== Grant Wellness Points ====================================

// UPDATE /api/shopkeeper/updateCredits - Updates the wellness points of any customer
shopkeeperRouter.patch(
  "/updateCredits",
  verifyToken,
  verifyShopkeeperStatus,
  checkSubscriptionStatus,
  async (req, res) => {
    try {
      const shopkeeperid = req.user?.id
      const customerid = req.body.customerid
      const credits_awarded = Number(req.body.credits_awarded)

      if (!shopkeeperid) {
        return res.status(401).json({ success: false, message: "Shopkeeper Id is empty" })
      }
      if (!customerid) {
        return res.status(401).json({ success: false, message: "Customer Id is empty" })
      }
      if (!Number.isFinite(credits_awarded) || credits_awarded <= 0) {
        return res.status(400).json({ success: false, message: "New credits were not sent." })
      }
      if (credits_awarded > 750) {
        return res.status(400).json({ success: false, message: "The amount of credits is too much" })
      }

      const [rows] = await pool.execute(
        "SELECT 1 FROM orders WHERE shopkeeper_id = ? AND user_id = ?",
        [shopkeeperid, customerid]
      )

      if (rows.length <= 0) {
        return res.status(400).json({ success: false, message: "Customer should have made at least one order from the shop" })
      }

      const [result] = await pool.execute(
        "UPDATE users SET store_credits = COALESCE(store_credits, 0) + ? WHERE id = ?",
        [credits_awarded, customerid]
      )

      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: "Customer Not found." })
      }

      return res.status(200).json({ success: true, message: "Credits awarded successfully" })

    } catch (error) {
      console.log("Error occurred while updating credits: " + error)
      return res.status(500).json({ success: false, message: "Internal Server error" })
    }
  }
);

// UPDATE /api/shopkeeper/:shopkeeperid/getcustomers - Get all the Nexkirana customers of the shop 
shopkeeperRouter.get(
  "/:shopkeeperid/getcustomers",
  verifyToken,
  verifyShopkeeperStatus,
  checkSubscriptionStatus,
  async (req, res) => {
    try {
      const shopkeeperIdFromToken = req.user?.id
      const { shopkeeperid: shopkeeperIdFromParams } = req.params

      if (!shopkeeperIdFromToken) {
        return res.status(401).json({ success: false, message: "Authentication required" })
      }
      if (String(shopkeeperIdFromParams) !== String(shopkeeperIdFromToken)) {
        return res.status(403).json({ success: false, message: "Forbidden" })
      }
      const shopkeeperid = shopkeeperIdFromToken

      const [rows] = await pool.execute(
        `SELECT DISTINCT u.id AS user_id, u.name, u.store_credits
     FROM orders o
     JOIN users u ON u.id = o.user_id
     WHERE o.shopkeeper_id = ?`,
        [shopkeeperid]
      )

      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: "No customer records found" })
      }

      return res.status(200).json({ success: true, result: rows })

    } catch (error) {
      console.log("Error occurred at get customers: " + error)
      return res.status(500).json({ success: false, message: "Internal Server error" })
    }
  }
);

export default shopkeeperRouter;