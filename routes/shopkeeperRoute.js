import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import express from "express";
import imagekit from "../config/imagekit.js";
import cloudinary from "../config/cloudinary.js"; // shim -> imagekit
import pool from "../config/db.js";
import nodeFetch from "node-fetch";
import { sendExpoPush } from "../utils/expoPush.js";
import { sendFCMPush, isFCMToken } from "../utils/fcmPush.js";
import upload from "../config/upload.js";
import verifyToken from "../middleware/auth.js";
import { checkSubscriptionStatus } from "../middleware/checkSubscription.js";
// import checkPaymentStatus from "../middleware/checkPaymentStatus.js"; // Disabled - earnings system not implemented
import {
  calculateSubscriptionStatus,
  canAccessApp,
} from "../utils/subscription.js";
import { createJWEToken } from "../utils/jweToken.js";
import { restoreStockForCancelledOrder } from "../utils/stockManager.js";
import { generateBill } from "../utils/revenue.js";

// Upload a buffer to ImageKit (products folder) and resolve with the result.
// Cloudinary shim kept for backward compat; uses ImageKit under the hood.
const uploadBufferToCloudinary = async (buffer, folder = "products") => {
  // name kept for minimal diff; actually uploads to ImageKit
  const streamifier = await import("streamifier");
  return new Promise((resolve, reject) => {
    const stream = imagekit.uploader.upload_stream(
      { folder },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    streamifier.default.createReadStream(buffer).pipe(stream);
  });
};

// Download an image from a URL and upload to ImageKit.
// This is used for re-uploading images from Cloudinary to ImageKit during import.
async function reuploadImageToImageKit(imageUrl) {
  if (!imageUrl) return null;

  try {
    // Download image from URL
    const response = await nodeFetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    // Upload to ImageKit
    const result = await uploadBufferToCloudinary(buffer);
    return result.secure_url;
  } catch (error) {
    console.error(`Failed to re-upload image ${imageUrl}:`, error.message);
    return imageUrl; // Return original URL on failure
  }
}

// Fetch a global product from inventory-backend by id.
// Tries the live HTTP API first (using the caller's auth header when given —
// inventory-backend accepts the same JWT_SECRET so shopkeeper tokens work there),
// then falls back to a direct Postgres query against the inventory-backend database
// (only when INVENTORY_DATABASE_URL explicitly points at the inventory Neon DB).
// The local `global_products` table in nexbackend is NOT the source of truth for
// catalog images — inventory-backend is.
async function getGlobalProductById(globalId, authHeader) {
  const INVENTORY_URL = process.env.INVENTORY_BACKEND_URL || "https://inventory-backend-lgpi.onrender.com";
  try {
    const res = await nodeFetch(`${INVENTORY_URL}/api/shopkeeper/global-products`, authHeader ? { headers: { Authorization: authHeader } } : undefined);
    if (!res.ok) throw new Error(`inventory-backend responded ${res.status}`);
    const json = await res.json();
    const list = json.products || json.data || [];
    const found = list.find((p) => Number(p.id) === Number(globalId));
    if (found) return found;
    throw new Error(`global product ${globalId} not found via HTTP (list size ${list.length})`);
  } catch (httpErr) {
    console.warn(`getGlobalProductById HTTP fetch failed: ${httpErr.message} — trying direct DB fallback`);
    // Fallback: direct Postgres query against inventory-backend's Neon DB.
    // IMPORTANT: never fall back to DATABASE_URL — that is nexbackend's OWN database.
    const connStr = process.env.INVENTORY_DATABASE_URL;
    if (!connStr) {
      console.warn("getGlobalProductById: INVENTORY_DATABASE_URL not set — no fallback available");
      return null;
    }
    try {
      const { Pool } = await import("pg");
      const pgPool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
      const r = await pgPool.query("SELECT * FROM global_products WHERE id = $1", [Number(globalId)]);
      await pgPool.end();
      if (r.rows.length === 0) return null;
      const row = r.rows[0];
      return {
        id: row.id,
        name: row.name,
        price: row.price,
        category: row.category,
        description: row.description,
        image: row.image,
        images: row.images || (row.image ? [row.image] : []),
        barcode: row.barcode,
        brand: row.brand,
        weight: row.weight,
        unit: row.unit,
      };
    } catch (pgErr) {
      console.warn("getGlobalProductById direct DB fallback failed:", pgErr.message);
      return null;
    }
  }
}

// Collect product image URLs from a request.
// Supports a legacy single `image` file and/or multiple `images` files, plus an
// optional `imageUrls` JSON array of already-hosted URLs to keep (e.g. existing
// images the client is preserving). `replaceImages=true` means the client wants
// the final set to be exactly what is provided (used to clear all images).
// Returns { images, image, provided } where `images` is null when nothing was
// sent (so callers can preserve the existing value).
async function collectProductImages(req) {
  const files = [];
  if (req.files?.images?.length) files.push(...req.files.images);
  if (req.files?.image?.length) files.push(req.files.image[0]);

  const uploaded = [];
  for (const f of files) {
    const result = await uploadBufferToCloudinary(f.buffer);
    uploaded.push(result.secure_url);
  }

  // Already-hosted URLs the client wants to keep (existing images).
  let keptUrls = [];
  if (req.body.imageUrls) {
    try {
      const parsed =
        typeof req.body.imageUrls === "string"
          ? JSON.parse(req.body.imageUrls)
          : req.body.imageUrls;
      if (Array.isArray(parsed)) {
        keptUrls = parsed.filter((u) => typeof u === "string");
      }
    } catch {
      /* ignore malformed */
    }
  } else if (typeof req.body.imageUrl === "string" && req.body.imageUrl) {
    keptUrls = [req.body.imageUrl];
  }

  const forceReplace =
    req.body.replaceImages === true || req.body.replaceImages === "true";
  const provided = files.length > 0 || keptUrls.length > 0 || forceReplace;

  if (!provided) {
    return { images: null, image: undefined, provided: false };
  }

  const images = [...keptUrls, ...uploaded];
  const image = images.length ? images[0] : null;
  return { images, image, provided: true };
}

// Middleware to check if shopkeeper is verified (compatible with existing database)
const verifyShopkeeperStatus = async (req, res, next) => {
  try {
    const [user] = await pool.execute(
      "SELECT * FROM shopkeepers WHERE id = ?",
      [req.user.id]
    );

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

      // Get pending orders count
      const [[pendingData]] = await pool.execute(
        "SELECT COUNT(*) AS pendingOrders FROM orders WHERE status = 'Pending' AND shopkeeper_id = ?",
        [shopkeeper_id]
      );

      // Get total products and low stock products for this shop
      const [[productStats]] = await pool.execute(
        "SELECT COUNT(*) AS totalProducts, SUM(CASE WHEN stock < 3 THEN 1 ELSE 0 END) AS lowStockProducts FROM products WHERE shop_id = ?",
        [shopkeeper_id]
      );

      // Get today's and yesterday's revenue from completed/delivered orders
      const [[todayRevenueData]] = await pool.execute(
        "SELECT COALESCE(SUM(total_amount), 0) AS todayRevenue FROM orders WHERE status IN ('Completed', 'Delivered') AND shopkeeper_id = ? AND DATE(created_at) = CURDATE()",
        [shopkeeper_id]
      );
      const [[yesterdayRevenueData]] = await pool.execute(
        "SELECT COALESCE(SUM(total_amount), 0) AS yesterdayRevenue FROM orders WHERE status IN ('Completed', 'Delivered') AND shopkeeper_id = ? AND DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)",
        [shopkeeper_id]
      );

      // Get top products by quantity sold today for this shop
      const [topProductsData] = await pool.execute(
        `SELECT p.id, p.name, p.price, p.image, SUM(oi.quantity) AS unitsSold
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         JOIN orders o ON oi.order_id = o.id
         WHERE o.shopkeeper_id = ? AND p.shop_id = ? AND o.status IN ('Completed', 'Delivered')
         GROUP BY p.id, p.name, p.price, p.image
         ORDER BY unitsSold DESC
         LIMIT 5`,
        [shopkeeper_id, shopkeeper_id]
      );

      // Get top customer today
      const [[topCustomerData]] = await pool.execute(
        `SELECT u.id, u.name, COUNT(*) AS orderCount, SUM(o.total_amount) AS totalSpent
         FROM orders o
         JOIN users u ON o.user_id = u.id
         WHERE o.shopkeeper_id = ? AND o.status IN ('Completed', 'Delivered') AND DATE(o.created_at) = CURDATE()
         GROUP BY u.id, u.name
         ORDER BY totalSpent DESC
         LIMIT 1`,
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
      } catch {
        // Column doesn't exist, use default
        homeDeliveryActive = true;
      }

      res.json({
        success: true,
        data: {
          isOnline: Boolean(shopkeeper.is_online),
          homeDeliveryActive: homeDeliveryActive,
          todayRevenue: parseFloat(todayRevenueData?.todayRevenue || 0),
          yesterdayRevenue: parseFloat(
            yesterdayRevenueData?.yesterdayRevenue || 0
          ),
          totalSales: parseFloat(salesData?.totalSales || 0),
          ordersDelivered: parseInt(deliveredData?.ordersDelivered || 0),
          cancelledOrders: parseInt(cancelledData?.cancelledOrders || 0),
          pendingOrders: parseInt(pendingData?.pendingOrders || 0),
          totalProducts: parseInt(productStats?.totalProducts || 0),
          lowStockProducts: parseInt(productStats?.lowStockProducts || 0),
          topProducts: topProductsData.map((p) => ({
            id: p.id,
            name: p.name,
            price: p.price,
            image: p.image,
            unitsSold: parseInt(p.unitsSold),
          })),
          topCustomer: topCustomerData
            ? {
                id: topCustomerData.id,
                name: topCustomerData.name,
                orderCount: parseInt(topCustomerData.orderCount),
                totalSpent: parseFloat(topCustomerData.totalSpent || 0),
              }
            : null,
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
      const search = req.query.search ? `%${req.query.search}%` : null;

      let sql;
      const params = [];

      if (search) {
        // Search across entire users table by name, email, phone, or zeu_id
        sql = `
          SELECT DISTINCT u.id, u.zeu_id, u.name as username, u.email, u.phone, u.store_credits as credits, u.wallet, u.img 
          FROM users u 
          WHERE u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR u.zeu_id LIKE ?
          LIMIT 50
        `;
        params.push(search, search, search, search);
      } else {
        // No search: return only users who have ordered from this shopkeeper
        sql = `
          SELECT DISTINCT u.id, u.zeu_id, u.name as username, u.email, u.phone, u.store_credits as credits, u.wallet, u.img 
          FROM users u 
          JOIN orders o ON u.id = o.user_id 
          WHERE o.shopkeeper_id = ?
        `;
        params.push(shopkeeper_id);
      }

      const [customers] = await pool.execute(sql, params);
      res.json({ success: true, data: customers });
    } catch (err) {
      console.error("Fetch customers error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// GET /api/shopkeeper/customers/orders - Get completed orders grouped by customer
shopkeeperRouter.get(
  "/customers/orders",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;

      const [orders] = await pool.execute(
        `SELECT 
          o.user_id,
          u.name as username,
          u.email,
          u.phone,
          u.store_credits as credits,
          o.id as order_id,
          o.total_amount,
          o.status,
          o.created_at,
          o.order_type,
          o.delivery_mode
        FROM orders o
        JOIN users u ON o.user_id = u.id
        WHERE o.shopkeeper_id = ? 
          AND o.status IN ('Completed', 'Delivered', 'completed', 'delivered')
        ORDER BY o.created_at DESC`,
        [shopkeeper_id]
      );

      // Group orders by customer
      const customerOrders = {};
      orders.forEach((order) => {
        if (!customerOrders[order.user_id]) {
          customerOrders[order.user_id] = {
            id: String(order.user_id),
            username: order.username,
            email: order.email,
            phone: order.phone,
            credits: order.credits,
            orders: [],
          };
        }
        customerOrders[order.user_id].orders.push({
          id: order.order_id,
          total_amount: order.total_amount,
          status: order.status,
          created_at: order.created_at,
          order_type: order.order_type,
          delivery_mode: order.delivery_mode,
        });
      });

      res.json({ success: true, data: Object.values(customerOrders) });
    } catch (err) {
      console.error("Fetch customer orders error:", err);
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
        return res.status(403).json({
          success: false,
          message: "Not authorized to update this customer",
        });
      }

      await pool.execute(
        "UPDATE users SET store_credits = COALESCE(store_credits, 0) + ? WHERE id = ?",
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
      const timeframe = req.query.timeframe || "weekly";

      let dateFilter = "";
      let previousDateFilter = "";
      let groupBy = "";

      if (timeframe === "daily") {
        dateFilter = "AND o.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
        previousDateFilter =
          "AND o.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) AND o.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)";
        groupBy = "DATE(o.created_at)";
      } else if (timeframe === "monthly") {
        dateFilter =
          "AND o.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01') AND o.created_at < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)";
        previousDateFilter =
          "AND o.created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH) AND o.created_at < DATE_FORMAT(CURDATE(), '%Y-%m-01')";
        groupBy = "DATE(o.created_at)";
      } else {
        // weekly
        dateFilter =
          "AND o.created_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) AND o.created_at < DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 7 DAY)";
        previousDateFilter =
          "AND o.created_at >= DATE_SUB(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 7 DAY) AND o.created_at < DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)";
        groupBy = "DATE(o.created_at)";
      }

      // Total Sales & Pending Orders
      const [[currentStats]] = await pool.query(
        `SELECT 
          SUM(CASE WHEN o.status IN ('Completed', 'Delivered') THEN o.total_amount ELSE 0 END) as totalSales,
          COUNT(CASE WHEN o.status = 'Pending' THEN 1 END) as pendingOrders,
          COUNT(CASE WHEN o.status IN ('Completed', 'Delivered') THEN 1 END) as completedCount,
          COUNT(CASE WHEN o.status != 'Cancelled' THEN 1 END) as totalOrdersCount
         FROM orders o
         WHERE o.shopkeeper_id = ? ${dateFilter}`,
        [shopkeeper_id]
      );

      const [[previousStats]] = await pool.query(
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

      const receivedPct =
        currentStats.totalOrdersCount > 0
          ? (currentStats.completedCount / currentStats.totalOrdersCount) * 100
          : 0;

      // Low Stock Count
      const [[lowStock]] = await pool.execute(
        `SELECT COUNT(*) as count FROM products WHERE shop_id = ? AND (stock <= baselineQty OR stock <= 5)`,
        [shopkeeper_id]
      );

      // Chart Data
      const [chartRows] = await pool.query(
        `SELECT ${groupBy} as day, SUM(o.total_amount) as revenue 
         FROM orders o
         WHERE o.shopkeeper_id = ? AND o.status IN ('Completed', 'Delivered') ${dateFilter}
         GROUP BY ${groupBy}`,
        [shopkeeper_id]
      );

      // Top Products
      const [topProducts] = await pool.query(
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
      const [topCustomers] = await pool.query(
        `SELECT u.id, u.name, COUNT(o.id) as orderCount, SUM(o.total_amount) as totalSpent
         FROM orders o
         JOIN users u ON o.user_id = u.id
         WHERE o.shopkeeper_id = ? AND o.status IN ('Completed', 'Delivered') ${dateFilter}
         GROUP BY u.id, u.name
         ORDER BY totalSpent DESC LIMIT 5`,
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
        topCustomers,
      });
    } catch (err) {
      console.error("Analytics error:", err.message, err.stack);
      res
        .status(500)
        .json({ success: false, message: "Server error", detail: err.message });
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
          const stream = imagekit.uploader.upload_stream(
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

    // Insert new shopkeeper — id is SERIAL (Postgres), auto-generated; is_verified NULL = pending (admin sees Approve/Reject)
    const [result] = await pool.execute(
      `INSERT INTO shopkeepers (name, email, password, phone, shop_name, address, latitude, longitude, img, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
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

    const newShopkeeperId = result.insertId;
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
            const stream = imagekit.uploader.upload_stream(
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
            const stream = imagekit.uploader.upload_stream(
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
      const { status } = req.query;

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

      // Fetch orders
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
        o.scheduled_time,
        o.pickup_code,
        o.payment_method,
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
        const placeholders = orderIds.map(() => "?").join(",");
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

        // Attach items to orders
        const orders = orderRows.map((order) => ({
          ...order,
          items: itemsByOrder[order.order_id] || [],
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

      if (status && typeof status === "string") {
        const lowerStatus = status.trim().toLowerCase();
        if (lowerStatus === "pending") status = "Pending";
        else if (lowerStatus === "completed") status = "Completed";
        else if (lowerStatus === "cancelled") status = "Cancelled";
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
        "SELECT id, user_id, credits_earned, credits_granted FROM orders WHERE id = ? AND shopkeeper_id = ?",
        [orderIdNum, shopkeeper_id]
      );

      if (orderCheck.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found or not assigned to you",
        });
      }

      const order = orderCheck[0];

      if (status === "Cancelled") {
        const cancelConn = await pool.getConnection();
        await cancelConn.beginTransaction();
        try {
          await cancelConn.execute(
            "UPDATE orders SET status = 'Cancelled', cancellation_reason = ? WHERE id = ?",
            [cancellation_reason, orderIdNum]
          );

          await restoreStockForCancelledOrder(
            orderIdNum,
            "shopkeeper",
            cancellation_reason || "Shopkeeper cancellation",
            cancelConn
          );

          const [[orderData]] = await cancelConn.execute(
            "SELECT credits_used, user_id FROM orders WHERE id = ?",
            [orderIdNum]
          );
          if (orderData?.credits_used > 0) {
            await cancelConn.execute(
              "UPDATE users SET store_credits = COALESCE(store_credits, 0) + ? WHERE id = ?",
              [orderData.credits_used, orderData.user_id]
            );
          }

          // Rollback wallet credit if already settled
          if (order.credits_earned > 0) {
            if (order.credits_granted) {
              await cancelConn.execute(
                "UPDATE users SET store_credits = GREATEST(COALESCE(store_credits, 0) - ?, 0) WHERE id = ?",
                [order.credits_earned, order.user_id]
              );
            }
            await cancelConn.execute(
              "UPDATE orders SET credits_earned = 0, credits_granted = 0 WHERE id = ?",
              [orderIdNum]
            );
          }

          await cancelConn.commit();
          cancelConn.release();
        } catch (err) {
          await cancelConn.rollback();
          cancelConn.release();
          throw err;
        }
      } else if (status === "Completed") {
        await pool.execute(
          "UPDATE orders SET status = 'Completed' WHERE id = ?",
          [orderIdNum]
        );

        // Settle pending wallet credit
        try {
          if (order.credits_earned > 0 && !order.credits_granted) {
            await pool.execute(
              "UPDATE users SET store_credits = COALESCE(store_credits, 0) + ? WHERE id = ?",
              [order.credits_earned, order.user_id]
            );
            await pool.execute(
              "UPDATE orders SET credits_granted = 1 WHERE id = ?",
              [orderIdNum]
            );
            console.log(
              `✅ Settled ${order.credits_earned} wallet credits for order ${orderIdNum}`
            );
          }
        } catch (settleErr) {
          console.error("Error settling wallet credits:", settleErr);
        }
      } else {
        await pool.execute("UPDATE orders SET status = ? WHERE id = ?", [
          status,
          orderIdNum,
        ]);
      }

      if (req.io) {
        const [[orderRow]] = await pool.execute(
          "SELECT user_id, shopkeeper_id, total_amount FROM orders WHERE id = ?",
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
          { orderId: orderIdNum, status },
          { action: "order_status_update", resourceId: String(orderIdNum) }
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
      // Ensure mrp is included in response
      const productsWithMrp = products.map((p) => ({
        ...p,
        mrp: p.mrp || null,
      }));
      res.json({ success: true, products: productsWithMrp });
    } catch (err) {
      console.error("Get products error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

/**
 * GET single product by id (fixes 404 on /products/:id)
 */
shopkeeperRouter.get(
  "/products/:id",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shop_id = req.user.id;
      const productId = req.params.id;
      const [rows] = await pool.execute(
        "SELECT * FROM products WHERE id = ? AND shop_id = ?",
        [productId, shop_id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: "Product not found" });
      }
      res.json({ success: true, product: rows[0] });
    } catch (err) {
      console.error("Get single product error:", err);
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
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "images", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      const shop_id = req.user.id;
      const {
        name,
        description,
        category,
        price,
        mrp,
        stock,
        baselineQty,
        barcode,
      } = req.body;

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

      // MRP defaults to price if not provided
      const parsedMrp = mrp != null ? Number(mrp) : parsedPrice;
      if (!Number.isNaN(parsedMrp) && parsedMrp >= 0) {
        if (parsedMrp < parsedPrice) {
          return res.status(400).json({
            success: false,
            message: "MRP cannot be less than selling price",
          });
        }
      }

      // Handle optional image upload(s)
      let imageUrl = null;
      let imagesArr = [];
      try {
        const collected = await collectProductImages(req);
        imageUrl = collected.image || null;
        imagesArr = collected.images || [];
      } catch (uploadErr) {
        console.error("Product image upload error:", uploadErr);
        return res
          .status(500)
          .json({ success: false, message: "Failed to upload image" });
      }

      // Validate global_product_id FK. If the id is not in the LOCAL global_products
      // table, fetch the product from inventory-backend (the catalog source of truth),
      // upsert it locally so the FK link is preserved, and (when the client did not
      // upload its own images) re-upload the catalog images to ImageKit.
      let globalProductId = req.body.global_product_id != null ? Number(req.body.global_product_id) : null;
      let globalProductData = null;
      if (globalProductId != null && !Number.isNaN(globalProductId)) {
        // Check the local catalog cache first. If the row exists but has no image
        // data (e.g. synced before the `images` column existed), treat it as stale.
        let localRowStale = true;
        try {
          const [gRow] = await pool.execute("SELECT id, name, price, category, description, image, images, barcode FROM global_products WHERE id = ?", [globalProductId]);
          if (gRow.length > 0) {
            let localImages = gRow[0].images;
            if (typeof localImages === "string") {
              try { localImages = JSON.parse(localImages); } catch { localImages = []; }
            }
            const hasImages = Array.isArray(localImages) && localImages.length > 0;
            if (hasImages) {
              globalProductData = {
                id: gRow[0].id,
                name: gRow[0].name,
                price: gRow[0].price,
                category: gRow[0].category,
                description: gRow[0].description,
                image: gRow[0].image,
                images: Array.isArray(localImages) && localImages.length ? localImages : (gRow[0].image ? [gRow[0].image] : []),
                barcode: gRow[0].barcode,
              };
              localRowStale = false;
            }
          }
        } catch (e) {
          console.warn("local global_products fetch failed:", e.message);
        }

        if (localRowStale) {
          // Not cached locally (or cache is stale) — fetch from inventory-backend,
          // the catalog source of truth, and upsert so the FK link is preserved.
          globalProductData = await getGlobalProductById(globalProductId, req.headers.authorization);
          if (globalProductData) {
            try {
              await pool.execute(
                `INSERT INTO global_products (id, name, price, category, description, image, images, barcode)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (id) DO UPDATE SET
                   image = EXCLUDED.image,
                   images = EXCLUDED.images`,
                [
                  globalProductId,
                  globalProductData.name,
                  parseFloat(Number(globalProductData.price).toFixed(2)),
                  globalProductData.category || null,
                  globalProductData.description || null,
                  globalProductData.image || null,
                  JSON.stringify(
                    Array.isArray(globalProductData.images) && globalProductData.images.length
                      ? globalProductData.images
                      : globalProductData.image
                        ? [globalProductData.image]
                        : []
                  ),
                  globalProductData.barcode || null,
                ]
              );
              console.log(`✅ Synced global product ${globalProductId} from inventory-backend into local global_products`);
            } catch (e) {
              console.warn("global_products upsert failed (continuing — FK may still be valid):", e.message);
            }
          }
        }

        if (!globalProductData) {
          console.warn(`⚠️ global_product_id ${globalProductId} not found in inventory-backend - nullifying FK`);
          globalProductId = null;
        }

        // When the client did not upload its own images, use the catalog images.
        // Catalog images live in Cloudinary (inventory-backend) — re-upload to ImageKit.
        if (globalProductId != null && !imageUrl && globalProductData) {
          const catalogImages = Array.isArray(globalProductData.images) && globalProductData.images.length
            ? globalProductData.images
            : globalProductData.image
              ? [globalProductData.image]
              : [];
          if (catalogImages.length > 0) {
            console.log(`Re-uploading ${catalogImages.length} catalog image(s) from Cloudinary to ImageKit for product: ${name}`);
            const imagekitUrls = [];
            for (const catalogUrl of catalogImages) {
              const imagekitUrl = await reuploadImageToImageKit(catalogUrl);
              imagekitUrls.push(imagekitUrl || catalogUrl);
            }
            imageUrl = imagekitUrls[0] || null;
            imagesArr = imagekitUrls;
          }
        }
      } else {
        globalProductId = null;
      }

      const [result] = await pool.execute(
        `INSERT INTO products (shop_id, name, description, category, price, mrp, stock, baselineQty, image, images, global_product_id, barcode, available_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          shop_id,
          name.trim(),
          description || null,
          category || null,
          formattedPrice,
          Number.isNaN(parsedMrp) || parsedMrp < 0
            ? formattedPrice
            : parseFloat(parsedMrp.toFixed(2)),
          finalStock,
          finalBaselineQty,
          imageUrl,
          JSON.stringify(imagesArr),
          globalProductId,
          barcode != null && String(barcode).trim() !== ""
            ? String(barcode).trim()
            : null,
          finalStock > 0 ? "IN STOCK" : "OUT OF STOCK",
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
      // Surface duplicate barcode etc as 400 instead of 500
      if (err.code === 'ER_DUP_ENTRY' || err.message?.includes('Duplicate')) {
        return res.status(409).json({ success: false, message: 'Duplicate barcode or product already exists', error: err.message });
      }
      // Postgres FK violation (e.g. global_product_id not in global_products)
      if (err.code === '23503' || err.message?.includes('violates foreign key') || err.message?.includes('global_product_id')) {
        return res.status(400).json({ success: false, message: 'Invalid global_product_id - referenced product does not exist', error: err.detail || err.message });
      }
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

/**
 * POST /api/shopkeeper/products/import-from-global
 * Fetch a global product from inventory-backend (Neon Postgres) and create it as a shop product in nexbackend (TiDB)
 * Body: { global_product_id, price?, mrp?, stock?, baselineQty?, shop_id? } - shop_id derived from token if not provided
 * This solves "fetch global products from inventory-backend and upload the selected product to nexbackend database"
 */
shopkeeperRouter.post(
  "/products/import-from-global",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shop_id = req.user.id;
      const { global_product_id, price: overridePrice, mrp: overrideMrp, stock, baselineQty } = req.body;

      if (!global_product_id) {
        return res.status(400).json({ success: false, message: "global_product_id is required" });
      }
      const globalId = Number(global_product_id);
      if (Number.isNaN(globalId)) {
        return res.status(400).json({ success: false, message: "global_product_id must be a number" });
      }

      // Check if already imported
      const [existingByGlobal] = await pool.execute(
        "SELECT id FROM products WHERE shop_id = ? AND global_product_id = ? LIMIT 1",
        [shop_id, globalId]
      );
      if (existingByGlobal.length > 0) {
        return res.status(409).json({ success: false, message: "Product already imported from global catalog", existingProductId: existingByGlobal[0].id });
      }

      // Fetch from inventory-backend via HTTP (uses shared JWT_SECRET so shopkeeper token works as shopkeeper token there)
      const authHeader = req.headers.authorization;
      let globalProduct = await getGlobalProductById(globalId, authHeader);
      if (!globalProduct) {
        return res.status(502).json({ success: false, message: `Failed to fetch global product ${globalId} from inventory-backend (HTTP and direct DB fallback both failed)` });
      }

      // Map fields
      const name = globalProduct.name;
      const category = globalProduct.category || null;
      const description = globalProduct.description || null;
      const barcode = globalProduct.barcode || null;
      // Price logic: override > global price
      const parsedGlobalPrice = Number(globalProduct.price);
      const parsedPrice = overridePrice != null ? Number(overridePrice) : parsedGlobalPrice;
      if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
        return res.status(400).json({ success: false, message: "Invalid price" });
      }
      const formattedPrice = parseFloat(parsedPrice.toFixed(2));
      let parsedMrp = overrideMrp != null ? Number(overrideMrp) : parsedPrice;
      if (Number.isNaN(parsedMrp) || parsedMrp < formattedPrice) parsedMrp = formattedPrice;
      const formattedMrp = parseFloat(parsedMrp.toFixed(2));

      let finalBaselineQty = baselineQty != null ? Number(baselineQty) : stock != null ? Number(stock) : 7;
      if (Number.isNaN(finalBaselineQty) || finalBaselineQty < 0) finalBaselineQty = 7;
      let finalStock = finalBaselineQty;

       const imageUrl = globalProduct.image || (Array.isArray(globalProduct.images) && globalProduct.images[0]) || null;
       const imagesArr = Array.isArray(globalProduct.images) && globalProduct.images.length ? globalProduct.images : (imageUrl ? [imageUrl] : []);

       // Re-upload images from Cloudinary to ImageKit
       console.log(`Re-uploading ${imagesArr.length} image(s) from Cloudinary to ImageKit for product: ${name}`);
       let imagekitImageUrls = [];
       for (let i = 0; i < imagesArr.length; i++) {
         const cloudinaryUrl = imagesArr[i];
         const imagekitUrl = await reuploadImageToImageKit(cloudinaryUrl);
         imagekitImageUrls.push(imagekitUrl || cloudinaryUrl); // Use original if re-upload fails
       }

       // Extract primary image and convert array to single image with ImageKit URLs
       const finalImageUrl = imagekitImageUrls[0] || imageUrl;
       const finalImagesArr = imagekitImageUrls.length ? imagekitImageUrls : (finalImageUrl ? [finalImageUrl] : []);

       // Check duplicate barcode in this shop's products
      if (barcode) {
        const [dup] = await pool.execute("SELECT id FROM products WHERE barcode = ? AND shop_id = ? LIMIT 1", [barcode, shop_id]);
        if (dup.length > 0) {
          return res.status(409).json({ success: false, message: `Barcode ${barcode} already exists for this shop`, existingProductId: dup[0].id });
        }
      }

      // Upsert the global product into the LOCAL global_products table so the
      // products.global_product_id FK reference is preserved (local table may be
      // empty — inventory-backend is the catalog source of truth).
      let insertGlobalId = globalId;
      try {
        await pool.execute(
          `INSERT INTO global_products (id, name, price, category, description, image, images, barcode)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             image = EXCLUDED.image,
             images = EXCLUDED.images`,
          [
            globalId,
            globalProduct.name,
            formattedPrice,
            globalProduct.category || null,
            globalProduct.description || null,
            finalImageUrl || globalProduct.image || null,
            JSON.stringify(
              Array.isArray(globalProduct.images) && globalProduct.images.length
                ? globalProduct.images
                : finalImageUrl
                  ? [finalImageUrl]
                  : []
            ),
            barcode,
          ]
        );
      } catch (e) {
        console.warn("global_products upsert failed, inserting with NULL FK:", e.message);
        insertGlobalId = null;
      }

       const [result] = await pool.execute(
         `INSERT INTO products (shop_id, name, description, category, price, mrp, stock, baselineQty, image, images, global_product_id, barcode, available_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
         [shop_id, name.trim(), description, category, formattedPrice, formattedMrp, finalStock, finalBaselineQty, finalImageUrl, JSON.stringify(finalImagesArr), insertGlobalId, barcode, finalStock > 0 ? "IN STOCK" : "OUT OF STOCK"]
       );
      const [created] = await pool.execute("SELECT * FROM products WHERE id = ?", [result.insertId]);
      res.status(201).json({ success: true, id: result.insertId, product: created[0], message: `Imported "${name}" from global catalog (global_id=${globalId}) to shop ${shop_id}` });
    } catch (err) {
      console.error("Import from global error:", err);
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ success: false, message: 'Duplicate entry (barcode likely)', error: err.message });
      }
      if (err.code === '23503' || err.message?.includes('violates foreign key')) {
        return res.status(400).json({ success: false, message: 'Invalid global_product_id FK', error: err.detail || err.message });
      }
      res.status(500).json({ success: false, message: "Server error", error: err.message });
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
        return res
          .status(400)
          .json({ success: false, message: "Baseline quantity is required" });
      }

      const b = Number(baselineQty);
      if (Number.isNaN(b) || b < 0) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid baseline quantity" });
      }

      const [result] = await pool.execute(
        "UPDATE products SET baselineQty = ?, stock = ? WHERE shop_id = ?",
        [b, b, shop_id]
      );

      await pool.execute(
        `UPDATE products SET available_stock = CASE WHEN stock = 0 THEN 'OUT OF STOCK' ELSE 'IN STOCK' END WHERE shop_id = ? AND available_stock <> 'INVISIBLE'`,
        [shop_id]
      );

      res.json({
        success: true,
        message: `Successfully updated baseline quantity for ${result.affectedRows} products`,
        updatedCount: result.affectedRows,
        baselineQty: b,
      });
    } catch (err) {
      console.error("Bulk update baseline error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

/**
 * BULK RESTOCK low-stock products to their baseline quantities
 */
shopkeeperRouter.post(
  "/products/bulk/restock",
  verifyToken,
  verifyShopkeeperStatus,
  checkSubscriptionStatus,
  async (req, res) => {
    try {
      const shop_id = req.user.id;

      // ✅ FIX: single atomic update. The previous version ran a second
      // UPDATE with `stock < baselineQty` AFTER stock had already been set
      // to baselineQty, so it matched zero rows and available_stock was
      // never flipped back to 'IN STOCK'.
      const [result] = await pool.execute(
        `UPDATE products
         SET stock = baselineQty,
             available_stock = CASE
               WHEN available_stock <> 'INVISIBLE' THEN 'IN STOCK'
               ELSE available_stock
             END
         WHERE shop_id = ? AND baselineQty > 0 AND stock < baselineQty`,
        [shop_id]
      );

      res.json({
        success: true,
        message: `Successfully restocked ${result.affectedRows} product(s) to baseline quantity`,
        updatedCount: result.affectedRows,
      });
    } catch (err) {
      console.error("Bulk restock error:", err);
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
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "images", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      const shop_id = req.user.id;
      const productId = req.params.id;
      const {
        name,
        description,
        category,
        price,
        mrp,
        stock,
        baselineQty,
        available_stock,
      } = req.body;

      const [existing] = await pool.execute(
        "SELECT * FROM products WHERE id = ? AND shop_id = ?",
        [productId, shop_id]
      );
      if (existing.length === 0)
        return res
          .status(404)
          .json({ success: false, message: "Product not found" });

      // Handle optional image upload(s)
      let imageUrl = existing[0].image;
      let imagesArr = existing[0].images
        ? JSON.parse(existing[0].images || "[]")
        : [];
      let imagesProvided = false;
      try {
        const collected = await collectProductImages(req);
        if (collected.provided) {
          imageUrl =
            collected.image != null ? collected.image : existing[0].image;
          imagesArr = collected.images || imagesArr;
          imagesProvided = true;
        }
      } catch (uploadErr) {
        console.error("Product image upload error:", uploadErr);
        return res
          .status(500)
          .json({ success: false, message: "Failed to upload image" });
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
      if (mrp != null) {
        const m = Number(mrp);
        if (Number.isNaN(m) || m < 0)
          return res
            .status(400)
            .json({ success: false, message: "Invalid MRP" });
        const formattedMrp = parseFloat(m.toFixed(2));
        // Validate that selling price does not exceed MRP
        const effectivePrice =
          price != null ? Number(price) : existing[0].price;
        if (effectivePrice != null && formattedMrp < effectivePrice) {
          return res.status(400).json({
            success: false,
            message: "MRP cannot be less than selling price",
          });
        }
        fields.push("mrp = ?");
        values.push(formattedMrp);
      }
      // Also validate if only price is being updated (mrp stays the same)
      if (price != null && mrp == null && existing[0].mrp != null) {
        const p = Number(price);
        if (p > Number(existing[0].mrp)) {
          return res.status(400).json({
            success: false,
            message: "Selling price cannot exceed MRP",
          });
        }
      }
      if (stock != null) {
        const s = Number(stock);
        if (Number.isNaN(s) || s < 0)
          return res
            .status(400)
            .json({ success: false, message: "Invalid stock" });
        fields.push("stock = ?");
        values.push(s);
      }

      // ✅ FIX: baselineQty handling. When stock is also provided (restock
      // flow), apply both independently so the added quantity is not lost.
      // Only sync stock to baseline when the caller did not send stock.
      if (baselineQty != null) {
        const b = Number(baselineQty);
        if (Number.isNaN(b) || b < 0)
          return res
            .status(400)
            .json({ success: false, message: "Invalid baseline quantity" });
        fields.push("baselineQty = ?");
        values.push(b);
        if (stock == null) {
          // Baseline-only update: keep stock in sync with the new baseline
          fields.push("stock = ?");
          values.push(b);
        }
      }
      if (req.body.barcode !== undefined) {
        fields.push("barcode = ?");
        values.push(
          req.body.barcode != null && String(req.body.barcode).trim() !== ""
            ? String(req.body.barcode).trim()
            : null
        );
      }
      if (available_stock != null) {
        const validStatuses = ["IN STOCK", "OUT OF STOCK", "INVISIBLE"];
        if (!validStatuses.includes(available_stock))
          return res.status(400).json({
            success: false,
            message:
              "Invalid available_stock value. Must be: IN STOCK, OUT OF STOCK, or INVISIBLE",
          });
        fields.push("available_stock = ?");
        values.push(available_stock);
      }

      if (imageUrl !== existing[0].image) {
        fields.push("image = ?");
        values.push(imageUrl);
      }

      if (imagesProvided) {
        fields.push("images = ?");
        values.push(JSON.stringify(imagesArr));
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

      if (available_stock == null) {
        let resolvedStock = null;
        if (stock != null) {
          resolvedStock = Number(stock);
        } else if (baselineQty != null) {
          resolvedStock = Number(baselineQty);
        }

        if (resolvedStock != null) {
          const syncStatus = resolvedStock === 0 ? "OUT OF STOCK" : "IN STOCK";
          await pool.execute(
            `UPDATE products SET available_stock = ? WHERE id = ? AND available_stock <> 'INVISIBLE'`,
            [syncStatus, productId]
          );
        }
      }

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

// Update only stock / available_stock for a shopkeeper's product (supports both numeric stock and enum available_stock for backward compat with shopkeeper api.js)
shopkeeperRouter.patch(
  "/products/:id/stock",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shop_id = req.user.id;
      const productId = req.params.id;
      const { stock, available_stock } = req.body;

      // Backward compat: if available_stock enum is sent to this endpoint (legacy shopkeeper api.js), handle it as available_stock update
      if (available_stock != null && stock == null) {
        const validStatuses = ["IN STOCK", "OUT OF STOCK", "INVISIBLE"];
        if (!validStatuses.includes(available_stock)) {
          return res.status(400).json({ success: false, message: "Invalid available_stock value. Must be: IN STOCK, OUT OF STOCK, or INVISIBLE" });
        }
        const [existing2] = await pool.execute("SELECT id, available_stock FROM products WHERE id = ? AND shop_id = ?", [productId, shop_id]);
        if (existing2.length === 0) return res.status(404).json({ success: false, message: "Product not found" });
        const previousStatus = existing2[0].available_stock;
        await pool.execute("UPDATE products SET available_stock = ? WHERE id = ? AND shop_id = ?", [available_stock, productId, shop_id]);
        const [updated2] = await pool.execute("SELECT * FROM products WHERE id = ? AND shop_id = ?", [productId, shop_id]);
        return res.json({ success: true, message: "Available stock updated", product: updated2[0], previous_status: previousStatus, new_status: available_stock });
      }

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

      const syncStatus = parsedStock === 0 ? "OUT OF STOCK" : "IN STOCK";
      await pool.execute(
        `UPDATE products SET available_stock = ? WHERE id = ? AND available_stock <> 'INVISIBLE'`,
        [syncStatus, productId]
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

// PATCH /api/shopkeeper/products/set-all-visible - Bulk set all invisible products to visible
shopkeeperRouter.patch(
  "/products/set-all-visible",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shop_id = req.user.id;

      const [result] = await pool.execute(
        `UPDATE products SET available_stock = 'IN STOCK'
         WHERE shop_id = ? AND available_stock = 'INVISIBLE'`,
        [shop_id]
      );

      const count = result.affectedRows || 0;

      console.log(`👁️ Set ${count} products visible for shop ${shop_id}`);

      res.json({
        success: true,
        message: `${count} product${count !== 1 ? "s" : ""} made visible`,
        count,
      });
    } catch (err) {
      console.error("Set all visible error:", err);
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
        `SELECT shop_scale, subscription_status, next_payment_due
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

      // Get all orders for this shopkeeper to calculate revenue and platform fees
      const [orders] = await pool.execute(
        `SELECT status, total_amount FROM orders WHERE shopkeeper_id = ?`,
        [shopkeeper_id]
      );

      const bill = generateBill(shopkeeper_id, orders);
      const shopData = shopkeeper[0] || {};

      res.json({
        success: true,
        data: {
          total_paid: payments[0]?.total_paid || 0,
          pending_amount: pendingPayments[0]?.pending_amount || 0,
          subscription_status: shopData.subscription_status || "active",
          shop_scale: shopData.shop_scale || "small",
          next_payment_due: shopData.next_payment_due,
          total_orders: orders.length,
          delivered_orders: bill.totalOrdersProcessed,
          total_sales: bill.grossRevenue,
          platform_fee_percentage: bill.platformFeePercentage,
          platform_fee_amount: bill.platformFeeAmount,
          net_payout_to_shopkeeper: bill.netPayoutToShopkeeper,
        },
      });
    } catch (err) {
      console.error("Get billing summary error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// GET /api/shopkeeper/generate-bill - Generate exact detailed platform fee bill/receipt
shopkeeperRouter.get(
  "/generate-bill",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;

      // Fetch all orders for this shopkeeper
      const [orders] = await pool.execute(
        `SELECT status, total_amount FROM orders WHERE shopkeeper_id = ?`,
        [shopkeeper_id]
      );

      // Generate the platform fee receipt/bill
      const bill = generateBill(shopkeeper_id, orders);

      res.json({
        success: true,
        bill: bill,
      });
    } catch (err) {
      console.error("Generate bill error:", err);
      res
        .status(500)
        .json({ success: false, message: "Server error", error: err.message });
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
        `SELECT shop_scale, subscription_status, next_payment_due, last_payment_date, grace_period_end
        FROM shopkeepers WHERE id = ?`,
        [shopkeeper_id]
      );

      if (shopkeeper.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Shopkeeper not found" });
      }

      const data = shopkeeper[0];
      const now = new Date();

      // Calculate payment status using subscription logic
      const nextPaymentDue = data.next_payment_due
        ? new Date(data.next_payment_due)
        : null;
      const gracePeriodEnd = data.grace_period_end
        ? new Date(data.grace_period_end)
        : null;

      const isPaymentOverdue = nextPaymentDue && now > nextPaymentDue;
      const isInGracePeriod =
        isPaymentOverdue && gracePeriodEnd && now <= gracePeriodEnd;
      const isAccountSuspended = gracePeriodEnd && now > gracePeriodEnd;

      let isBlocked = false;
      let pendingAmount = 0;
      let nextPaymentDate = data.next_payment_due;

      // Get shop scale to determine fee amount
      const scale = data.shop_scale || "small";
      const scaleFees = { small: 299, medium: 799, large: 1999 };
      const feeAmount = scaleFees[scale] || 299;

      if (isAccountSuspended) {
        isBlocked = true;
        pendingAmount = feeAmount;
      } else if (isInGracePeriod) {
        // Not blocked yet, but payment needed
        pendingAmount = feeAmount;
        isBlocked = false;
      } else if (isPaymentOverdue) {
        // Overdue but before grace period (shouldn't happen with current logic)
        pendingAmount = feeAmount;
        isBlocked = false;
      }

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
          shop_scale: scale,
          next_payment_due: data.next_payment_due,
          last_payment_date: data.last_payment_date,
          paid_this_month: monthPayments[0]?.paid_this_month || 0,
          // PaymentBlocker expected fields:
          isBlocked,
          pendingAmount,
          nextPaymentDate,
          status: isAccountSuspended
            ? "blocked"
            : isInGracePeriod
              ? "grace_period"
              : "active",
          feeAmount,
          graceDaysRemaining: gracePeriodEnd
            ? Math.max(
                0,
                Math.ceil((gracePeriodEnd - now) / (1000 * 60 * 60 * 24))
              )
            : 0,
        },
      });
    } catch (err) {
      console.error("Get billing status error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// Update shop scale
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

    res.json({
      success: true,
      message: `Shop scale updated to ${shop_scale}`,
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
      "SELECT shop_scale, subscription_status, last_payment_date, next_payment_due, grace_period_end, is_verified FROM shopkeepers WHERE id = ?",
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
        is_verified: data.is_verified === 1 || data.is_verified === true,
        can_access:
          data.subscription_status !== "suspended" &&
          (data.is_verified === 1 || data.is_verified === true),
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

// Verify pickup code and mark order as Completed
shopkeeperRouter.post(
  "/orders/:orderId/verify-pickup",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;
      const { orderId } = req.params;
      const { pickup_code } = req.body;

      const orderIdNum = parseInt(orderId);
      if (isNaN(orderIdNum)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid order ID" });
      }

      if (!pickup_code) {
        return res
          .status(400)
          .json({ success: false, message: "Pickup code is required" });
      }

      // Check if order exists and is assigned to this shopkeeper
      const [orderRows] = await pool.execute(
        `SELECT id, status, pickup_code, user_id, created_at, total_amount, order_type, credits_earned, credits_granted
         FROM orders
         WHERE id = ? AND shopkeeper_id = ?`,
        [orderIdNum, shopkeeper_id]
      );

      if (orderRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found or not assigned to you",
        });
      }

      const order = orderRows[0];

      // Check if order is already completed
      if (order.status === "Completed") {
        return res.status(400).json({
          success: false,
          message: "Order is already completed",
        });
      }

      // Check if order is cancelled
      if (order.status === "Cancelled") {
        return res.status(400).json({
          success: false,
          message: "Order has been cancelled",
        });
      }

      // Verify the pickup code (case insensitive/trimmed comparison)
      const expectedCode = String(order.pickup_code || "").trim();
      const providedCode = String(pickup_code || "").trim();

      if (expectedCode !== providedCode) {
        return res.status(400).json({
          success: false,
          message: "Invalid pickup code. Please check and try again.",
        });
      }

      // Update status to Completed
      await pool.execute(
        "UPDATE orders SET status = 'Completed' WHERE id = ?",
        [orderIdNum]
      );

      // Settle pending wallet credit
      let walletCreditSettled = 0;
      try {
        if (order.credits_earned > 0 && !order.credits_granted) {
          await pool.execute(
            "UPDATE users SET store_credits = COALESCE(store_credits, 0) + ? WHERE id = ?",
            [order.credits_earned, order.user_id]
          );
          await pool.execute(
            "UPDATE orders SET credits_granted = 1 WHERE id = ?",
            [orderIdNum]
          );
          walletCreditSettled = order.credits_earned;
          console.log(
            `✅ Settled ${walletCreditSettled} wallet credits for order ${orderIdNum}`
          );
        }
      } catch (settleErr) {
        console.error(
          "Error settling wallet credits in verify-pickup:",
          settleErr
        );
      }

      // Emit Socket.IO events if req.io is available
      if (req.io) {
        const payload = {
          orderId: orderIdNum,
          order_id: orderIdNum,
          status: "Completed",
          originalStatus: "Completed",
          userId: order.user_id,
          user_id: order.user_id,
          shopkeeperId: shopkeeper_id,
          shopkeeper_id: shopkeeper_id,
          totalAmount: parseFloat(order.total_amount),
          total_amount: parseFloat(order.total_amount),
          updatedAt: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          walletCreditSettled,
        };

        const shopRoom = `shop_${Number(shopkeeper_id)}`;
        const customerRoom = `customer_${Number(order.user_id)}`;

        req.io.to(shopRoom).emit("orderStatusUpdate", payload);
        req.io.to(customerRoom).emit("orderStatusUpdate", payload);
        req.io.to("admin").emit("orderStatusUpdate", payload);
      }

      // Send push notification to customer
      try {
        const [[customer]] = await pool.execute(
          "SELECT expo_push_token FROM users WHERE id = ?",
          [order.user_id]
        );

        if (customer?.expo_push_token) {
          const message =
            walletCreditSettled > 0
              ? `🎉 Your order #${orderIdNum} has been verified and completed! You earned ₹${(walletCreditSettled * 0.1).toFixed(0)} in wallet credit.`
              : `🎉 Your order #${orderIdNum} has been verified and completed!`;
          const token = customer.expo_push_token;
          if (isFCMToken(token)) {
            await sendFCMPush(token, "Order Completed", message, {
              orderId: String(orderIdNum),
              status: "Completed",
            });
          } else {
            await sendExpoPush(
              token,
              "Order Completed",
              message,
              {
                orderId: String(orderIdNum),
                status: "Completed",
              },
              { action: "order_completed", resourceId: String(orderIdNum) }
            );
          }
        }
      } catch (pushError) {
        console.error("Push notification error in verify-pickup:", pushError);
      }

      return res.json({
        success: true,
        message: `Pickup verified successfully. Order completed!`,
        order_status: "Completed",
      });
    } catch (err) {
      console.error("Verify pickup error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
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

// GET /api/shopkeeper/store-health - Calculate store health score
shopkeeperRouter.get(
  "/store-health",
  verifyToken,
  verifyShopkeeperStatus,
  checkSubscriptionStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;

      // Get various metrics for health calculation
      const [
        [ordersStats],
        [productsStats],
        [customersStats],
        [revenueStats],
        [activityStats],
      ] = await Promise.all([
        // Orders metrics
        pool.execute(
          `
          SELECT 
            COUNT(*) as total_orders,
            SUM(CASE WHEN status IN ('Completed', 'Delivered') THEN 1 ELSE 0 END) as completed_orders,
            SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
            SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending_orders
          FROM orders 
          WHERE shopkeeper_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        `,
          [shopkeeper_id]
        ),

        // Products metrics
        pool.execute(
          `
          SELECT 
            COUNT(*) as total_products,
            SUM(CASE WHEN stock <= baselineQty OR stock <= 5 THEN 1 ELSE 0 END) as low_stock_products,
            SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END) as out_of_stock_products
          FROM products 
          WHERE shop_id = ?
        `,
          [shopkeeper_id]
        ),

        // Customers metrics
        pool.execute(
          `
          SELECT 
            COUNT(DISTINCT user_id) as total_customers,
            SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as new_customers_week
          FROM orders 
          WHERE shopkeeper_id = ? AND status IN ('Completed', 'Delivered')
        `,
          [shopkeeper_id]
        ),

        // Revenue metrics
        pool.execute(
          `
          SELECT 
            COALESCE(SUM(total_amount), 0) as revenue_30d,
            COALESCE(SUM(total_amount), 0) as revenue_7d
          FROM orders 
          WHERE shopkeeper_id = ? 
            AND status IN ('Completed', 'Delivered')
            AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        `,
          [shopkeeper_id]
        ),

        // Activity metrics (last login, order response time)
        pool.execute(
          `
          SELECT 
            MAX(created_at) as last_order_date,
            AVG(TIMESTAMPDIFF(MINUTE, created_at, updated_at)) as avg_response_minutes
          FROM orders 
          WHERE shopkeeper_id = ? AND status IN ('Completed', 'Delivered')
            AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        `,
          [shopkeeper_id]
        ),
      ]);

      const o = ordersStats[0];
      const p = productsStats[0];
      const c = customersStats[0];
      const r = revenueStats[0];
      const a = activityStats[0];

      // Calculate health score (0-100)
      // Factors:
      // 1. Order completion rate (25%)
      // 2. Low stock management (20%)
      // 3. Customer retention/growth (15%)
      // 4. Revenue trend (15%)
      // 5. Response time (15%)
      // 6. Stock availability (10%)

      const totalOrders = o.total_orders || 0;
      const completedOrders = o.completed_orders || 0;
      const cancelledOrders = o.cancelled_orders || 0;
      const completionRate =
        totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 100;
      const cancellationRate =
        totalOrders > 0 ? (cancelledOrders / totalOrders) * 100 : 0;

      const totalProducts = p.total_products || 0;
      const lowStockProducts = p.low_stock_products || 0;
      const outOfStockProducts = p.out_of_stock_products || 0;
      const stockHealthRate =
        totalProducts > 0
          ? (1 - outOfStockProducts / totalProducts) * 100
          : 100;

      const totalCustomers = c.total_customers || 0;
      const newCustomersWeek = c.new_customers_week || 0;
      const customerGrowthRate =
        totalCustomers > 0 ? (newCustomersWeek / totalCustomers) * 100 : 0;

      const revenue30d = parseFloat(r.revenue_30d) || 0;
      const revenue7d = parseFloat(r.revenue_7d) || 0;
      const revenueTrend =
        revenue30d > 0 ? (revenue7d / (revenue30d / 4.3)) * 100 : 100; // weekly vs monthly avg

      const avgResponseMinutes = a.avg_response_minutes || 0;
      const responseScore =
        avgResponseMinutes <= 10
          ? 100
          : avgResponseMinutes <= 30
            ? 80
            : avgResponseMinutes <= 60
              ? 60
              : 40;

      // Weighted score
      let healthScore = 0;
      healthScore += completionRate * 0.25;
      healthScore += stockHealthRate * 0.2;
      healthScore += Math.min(customerGrowthRate * 5, 100) * 0.15; // Cap at 100
      healthScore += Math.min(revenueTrend, 100) * 0.15;
      healthScore += responseScore * 0.15;
      healthScore +=
        (100 - (lowStockProducts / Math.max(totalProducts, 1)) * 100) * 0.1;

      healthScore = Math.round(Math.max(0, Math.min(100, healthScore)));

      // Determine health status
      let healthStatus = "excellent";
      if (healthScore >= 80) healthStatus = "excellent";
      else if (healthScore >= 60) healthStatus = "good";
      else if (healthScore >= 40) healthStatus = "fair";
      else healthStatus = "needs_attention";

      // Generate recommendations
      const recommendations = [];
      if (completionRate < 90)
        recommendations.push("Improve order completion rate");
      if (outOfStockProducts > 0)
        recommendations.push(
          `Restock ${outOfStockProducts} out-of-stock products`
        );
      if (lowStockProducts > totalProducts * 0.3)
        recommendations.push("Too many low-stock items");
      if (customerGrowthRate < 5)
        recommendations.push("Focus on customer acquisition");
      if (avgResponseMinutes > 30)
        recommendations.push("Improve order response time");
      if (revenueTrend < 80)
        recommendations.push("Revenue declining - consider promotions");

      res.json({
        success: true,
        data: {
          score: healthScore,
          status: healthStatus,
          metrics: {
            orders: {
              total: totalOrders,
              completed: completedOrders,
              cancelled: cancelledOrders,
              completionRate: Math.round(completionRate * 10) / 10,
              cancellationRate: Math.round(cancellationRate * 10) / 10,
            },
            products: {
              total: totalProducts,
              lowStock: lowStockProducts,
              outOfStock: outOfStockProducts,
              stockHealthRate: Math.round(stockHealthRate * 10) / 10,
            },
            customers: {
              total: totalCustomers,
              newThisWeek: newCustomersWeek,
              growthRate: Math.round(customerGrowthRate * 10) / 10,
            },
            revenue: {
              last30Days: revenue30d,
              last7Days: revenue7d,
              trend: Math.round(revenueTrend),
            },
            operations: {
              avgResponseMinutes: Math.round(avgResponseMinutes),
              responseScore,
            },
          },
          recommendations:
            recommendations.length > 0
              ? recommendations
              : ["All systems healthy"],
        },
      });
    } catch (err) {
      console.error("Store health calculation error:", err);
      res.status(500).json({
        success: false,
        message: "Failed to calculate store health",
        error: err.message,
      });
    }
  }
);

// GET /api/shopkeeper/payment-modal-data - Get payment modal data for grace period/suspension
shopkeeperRouter.get(
  "/payment-modal-data",
  verifyToken,
  verifyShopkeeperStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;

      // Get subscription status
      const statusInfo = await calculateSubscriptionStatus(shopkeeper_id);

      // Get payment info for payment instructions
      const [paymentRows] = await pool
        .query(
          "SELECT upi_id, bank_account, bank_name, ifsc_code, account_holder, qr_code FROM payment_info WHERE type = 'admin' LIMIT 1"
        )
        .catch(() => [[]]);

      const paymentInfo =
        paymentRows.length > 0
          ? paymentRows[0]
          : {
              upi_id: "",
              bank_account: "",
              bank_name: "",
              ifsc_code: "",
              account_holder: "NexKirana Admin",
              qr_code: null,
            };

      // Calculate amount due (based on shop scale)
      let amountDue = 0;
      const [shopkeeper] = await pool.execute(
        "SELECT shop_scale FROM shopkeepers WHERE id = ?",
        [shopkeeper_id]
      );
      const scale = shopkeeper[0]?.shop_scale || "small";
      const scaleFees = { small: 299, medium: 799, large: 1999 };
      amountDue = scaleFees[scale] || 299;

      let modalType = null;
      let title = "";
      let message = "";
      let showPayButton = false;
      let payButtonText = "";
      let urgency = "low";

      if (statusInfo.isAccountSuspended) {
        modalType = "suspended";
        title = "Account Suspended";
        message = `Your account has been suspended due to payment overdue by ${statusInfo.daysOverdue} day(s). Please make the payment to reactivate your account.`;
        showPayButton = true;
        payButtonText = `Pay ₹${amountDue} to Reactivate`;
        urgency = "high";
      } else if (statusInfo.isInGracePeriod) {
        modalType = "grace_period";
        title = "Payment Overdue - Grace Period";
        message = `Your payment of ₹${amountDue} is overdue. You have ${statusInfo.graceDaysRemaining} grace day(s) remaining to make payment before your account is suspended.`;
        showPayButton = true;
        payButtonText = `Pay ₹${amountDue} Now`;
        urgency = "medium";
      } else if (statusInfo.needsPayment && statusInfo.daysOverdue > 0) {
        modalType = "overdue";
        title = "Payment Overdue";
        message = `Your payment of ₹${amountDue} is overdue by ${statusInfo.daysOverdue} day(s). Please pay to avoid suspension.`;
        showPayButton = true;
        payButtonText = `Pay ₹${amountDue} Now`;
        urgency = "medium";
      }

      // Only return modal data if there's an issue
      if (!modalType) {
        return res.json({
          success: true,
          data: { showModal: false },
        });
      }

      res.json({
        success: true,
        data: {
          showModal: true,
          modalType,
          title,
          message,
          urgency,
          amountDue,
          showPayButton,
          payButtonText,
          paymentInfo: {
            upi_id: paymentInfo.upi_id,
            bank_account: paymentInfo.bank_account,
            bank_name: paymentInfo.bank_name,
            ifsc_code: paymentInfo.ifsc_code,
            account_holder: paymentInfo.account_holder,
            qr_code: paymentInfo.qr_code,
          },
          subscription: {
            status: statusInfo.status,
            daysOverdue: statusInfo.daysOverdue,
            graceDaysRemaining: statusInfo.graceDaysRemaining,
            nextPaymentDue: statusInfo.nextPaymentDue,
            gracePeriodEnd: statusInfo.gracePeriodEnd,
          },
        },
      });
    } catch (err) {
      console.error("Payment modal data error:", err);
      res.status(500).json({
        success: false,
        message: "Failed to get payment modal data",
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
    const connection = await pool.getConnection();
    try {
      const shopkeeperid = req.user?.id;
      const customerid = req.body.customerid;
      const credits_awarded = Number(req.body.credits_awarded);

      if (!shopkeeperid) {
        connection.release();
        return res
          .status(401)
          .json({ success: false, message: "Shopkeeper Id is empty" });
      }
      if (!customerid) {
        connection.release();
        return res
          .status(401)
          .json({ success: false, message: "Customer Id is empty" });
      }
      if (!Number.isFinite(credits_awarded) || credits_awarded <= 0) {
        connection.release();
        return res
          .status(400)
          .json({ success: false, message: "New credits were not sent." });
      }
      if (credits_awarded > 750) {
        connection.release();
        return res.status(400).json({
          success: false,
          message: "The amount of credits is too much",
        });
      }

      const [rows] = await connection.execute(
        "SELECT 1 FROM orders WHERE shopkeeper_id = ? AND user_id = ?",
        [shopkeeperid, customerid]
      );

      if (rows.length <= 0) {
        connection.release();
        return res.status(400).json({
          success: false,
          message: "Customer should have made at least one order from the shop",
        });
      }

      await connection.beginTransaction();

      const [result] = await connection.execute(
        "UPDATE users SET store_credits = COALESCE(store_credits, 0) + ? WHERE id = ?",
        [credits_awarded, customerid]
      );

      if (result.affectedRows === 0) {
        await connection.rollback();
        connection.release();
        return res
          .status(404)
          .json({ success: false, message: "Customer Not found." });
      }

      await connection.commit();
      connection.release();

      return res
        .status(200)
        .json({ success: true, message: "Credits awarded successfully" });
    } catch (error) {
      if (connection) {
        await connection.rollback().catch(() => {});
        connection.release();
      }
      console.log("Error occurred while updating credits: " + error);
      return res
        .status(500)
        .json({ success: false, message: "Internal Server error" });
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
      const shopkeeperIdFromToken = req.user?.id;
      const { shopkeeperid: shopkeeperIdFromParams } = req.params;

      if (!shopkeeperIdFromToken) {
        return res
          .status(401)
          .json({ success: false, message: "Authentication required" });
      }
      if (String(shopkeeperIdFromParams) !== String(shopkeeperIdFromToken)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
      const shopkeeperid = shopkeeperIdFromToken;

      const [rows] = await pool.execute(
        `SELECT DISTINCT u.id AS user_id, u.name, u.store_credits
     FROM orders o
     JOIN users u ON u.id = o.user_id
     WHERE o.shopkeeper_id = ?`,
        [shopkeeperid]
      );

      if (rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "No customer records found" });
      }

      return res.status(200).json({ success: true, result: rows });
    } catch (error) {
      console.log("Error occurred at get customers: " + error);
      return res
        .status(500)
        .json({ success: false, message: "Internal Server error" });
    }
  }
);

/**
 * POST /shopkeeper/orders/create
 * Manually create an order for a customer (used by shopkeeper POS flow)
 */
shopkeeperRouter.post(
  "/orders/create",
  verifyToken,
  verifyShopkeeperStatus,
  checkSubscriptionStatus,
  async (req, res) => {
    try {
      const shopkeeper_id = req.user.id;
      const { customer_id, total_amount, amount_paid, items } = req.body;

      if (!customer_id) {
        return res
          .status(400)
          .json({ success: false, message: "Customer ID is required" });
      }
      // Use amount_paid (what customer actually pays after discount) as total_amount
      // Fallback to total_amount for backward compatibility
      const finalAmount = amount_paid || total_amount;
      if (!finalAmount || finalAmount <= 0) {
        return res
          .status(400)
          .json({ success: false, message: "Valid amount is required" });
      }

      // Calculate credits based on amount paid (what customer actually pays)
      // Must match frontend calcValues: creditPoints = walletRupees * 10
      // walletRupees = totalDiscount / 2 (approximately), totalDiscount = amount * rate
      // rate: >=1000: 0.05, >=500: 0.03, >=50: 0.02
      // So credits = amount * rate * 5 (capped at 1500 for >=1000)
      const calculateCredits = (amount) => {
        let rate = 0;
        if (amount >= 1000) rate = 0.05;
        else if (amount >= 500) rate = 0.03;
        else if (amount >= 50) rate = 0.02;

        const totalDiscount = amount * rate;
        const cappedDiscount =
          rate === 0.05 ? Math.min(totalDiscount, 150) : totalDiscount;
        const credits = Math.round(cappedDiscount * 5); // walletRupees * 10 = (totalDiscount/2) * 10 = totalDiscount * 5

        // Cap credits at 1500 for >=1000 (150 * 10 = 1500)
        if (rate === 0.05) return Math.min(credits, 1500);
        return credits;
      };

      const creditsEarned = calculateCredits(finalAmount);

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        // Verify customer exists
        const [[customer]] = await conn.execute(
          "SELECT id FROM users WHERE id = ?",
          [customer_id]
        );
        if (!customer) {
          await conn.rollback();
          conn.release();
          return res
            .status(404)
            .json({ success: false, message: "Customer not found" });
        }

        // Insert the order — id is SERIAL (Postgres), auto-generated
        const [orderResult] = await conn.execute(
          `INSERT INTO orders (user_id, shopkeeper_id, status, payment_method, total_amount, credits_earned, credits_used, credits_granted, order_type, created_at)
           VALUES (?, ?, 'Completed', 'manual', ?, ?, 0, 1, 'manual', NOW())`,
          [customer_id, shopkeeper_id, finalAmount, creditsEarned]
        );
        const orderId = orderResult.insertId;

        // Grant credits to customer immediately
        if (creditsEarned > 0) {
          await conn.execute(
            "UPDATE users SET store_credits = COALESCE(store_credits, 0) + ? WHERE id = ?",
            [creditsEarned, customer_id]
          );
        }

        // Insert order items if provided
        if (items && Array.isArray(items) && items.length > 0) {
          const itemValues = [];
          const itemParams = [];
          for (const item of items) {
            const productId = item.productId || item.product_id;
            const quantity = item.quantity || item.qty || 1;
            const price = item.price || 0;
            if (!productId) continue;
            itemValues.push("(?, ?, ?, ?)");
            itemParams.push(orderId, productId, quantity, price);
          }

          if (itemValues.length > 0) {
            await conn.execute(
              `INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ${itemValues.join(", ")}`,
              itemParams
            );
          }
        }

        await conn.commit();
        conn.release();

        return res.status(201).json({
          success: true,
          message: "Order created and completed successfully",
          order: { id: orderId, credits_earned: creditsEarned },
        });
      } catch (err) {
        await conn.rollback();
        conn.release();
        throw err;
      }
    } catch (error) {
      console.error("Error creating order:", error);
      return res
        .status(500)
        .json({ success: false, message: "Internal Server error" });
    }
  }
);

// ============================================================================
// SHOPKEEPER NOTIFICATIONS
// ============================================================================

let ensureNotificationsTablePromise = null;
const ensureNotificationsTable = () => {
  if (!ensureNotificationsTablePromise) {
    ensureNotificationsTablePromise = pool
      .execute(
        `CREATE TABLE IF NOT EXISTS shopkeeper_notifications (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          shopkeeper_id INT NOT NULL,
          type VARCHAR(50) DEFAULT 'general',
          title VARCHAR(255) NOT NULL,
          body TEXT,
          order_id INT NULL,
          data JSON NULL,
          is_read TINYINT(1) NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_shopkeeper_notif_shop (shopkeeper_id, is_read)
        )`
      )
      .catch((err) => {
        ensureNotificationsTablePromise = null;
        throw err;
      });
  }
  return ensureNotificationsTablePromise;
};

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

/**
 * GET /api/shopkeeper/notifications
 * List notifications for the logged-in shopkeeper.
 */
shopkeeperRouter.get("/notifications", verifyToken, async (req, res) => {
  try {
    const shopkeeperId = req.user.id;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);

    await ensureNotificationsTable();

    const [notifications] = await pool.execute(
      `SELECT id, type, title, body, order_id, data, is_read, created_at
       FROM shopkeeper_notifications
       WHERE shopkeeper_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [shopkeeperId, limit]
    );

    const [unreadRows] = await pool.execute(
      `SELECT COUNT(*) AS unreadCount
       FROM shopkeeper_notifications
       WHERE shopkeeper_id = ? AND is_read = 0`,
      [shopkeeperId]
    );

    res.json({
      success: true,
      notifications: notifications.map((n) => ({
        ...n,
        data: typeof n.data === "string" ? safeJsonParse(n.data) : n.data || {},
      })),
      unreadCount: Number(unreadRows[0]?.unreadCount) || 0,
    });
  } catch (err) {
    console.error("Get shopkeeper notifications error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to load notifications" });
  }
});

/**
 * POST /api/shopkeeper/notifications/read
 * Mark the given notification ids as read. Body: { ids: number[] }
 */
shopkeeperRouter.post("/notifications/read", verifyToken, async (req, res) => {
  try {
    const shopkeeperId = req.user.id;
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [];

    if (ids.length === 0) {
      return res.json({ success: true, updated: 0 });
    }

    await ensureNotificationsTable();

    const placeholders = ids.map(() => "?").join(",");
    const [result] = await pool.execute(
      `UPDATE shopkeeper_notifications
       SET is_read = 1
       WHERE shopkeeper_id = ? AND id IN (${placeholders})`,
      [shopkeeperId, ...ids]
    );

    res.json({ success: true, updated: result.affectedRows || 0 });
  } catch (err) {
    console.error("Mark notifications read error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to mark notifications read" });
  }
});

/**
 * POST /api/shopkeeper/notifications/read-all
 * Mark all notifications as read for the logged-in shopkeeper.
 */
shopkeeperRouter.post(
  "/notifications/read-all",
  verifyToken,
  async (req, res) => {
    try {
      const shopkeeperId = req.user.id;

      await ensureNotificationsTable();

      const [result] = await pool.execute(
        `UPDATE shopkeeper_notifications
       SET is_read = 1
       WHERE shopkeeper_id = ? AND is_read = 0`,
        [shopkeeperId]
      );

      res.json({ success: true, updated: result.affectedRows || 0 });
    } catch (err) {
      console.error("Mark all notifications read error:", err);
      res.status(500).json({
        success: false,
        message: "Failed to mark all notifications read",
      });
    }
  }
);

export default shopkeeperRouter;
