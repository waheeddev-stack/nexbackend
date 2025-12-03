import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import express from "express";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import cloudinary from "../config/cloudinary.js";
import pool from "../config/db.js";
import { sendExpoPush } from "../utils/expoPush.js";
import upload from "../config/upload.js";
import verifyToken from "../middleware/auth.js";
import checkPaymentStatus from "../middleware/checkPaymentStatus.js";
import { awardWellnessPoints } from "../utils/wellnessPoints.js";

// Middleware to check if shopkeeper is verified
const verifyShopkeeperStatus = async (req, res, next) => {
  try {
    const [user] = await pool.query(
      "SELECT verification_status FROM shopkeepers WHERE id = ?",
      [req.user.id]
    );

    if (user.length === 0) {
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
    }

    if (user[0].verification_status !== 'verified') {
      return res.status(403).json({ 
        success: false, 
        message: "Account verification required. Please wait for admin approval.",
        verification_status: user[0].verification_status
      });
    }

    next();
  } catch (err) {
    console.error("Verification check error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
dotenv.config();

const shopkeeperRouter = express.Router();

shopkeeperRouter.get("/stats", verifyToken, verifyShopkeeperStatus, async (req, res) => {
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
      "SELECT SUM(total_amount) AS totalSales FROM orders WHERE status='Delivered' AND shopkeeper_id = ?",
      [shopkeeper_id]
    );
    const [[totalDelivered]] = await pool.query(
      "SELECT COUNT(*) AS totalDelivered FROM orders WHERE status='Delivered' AND shopkeeper_id = ?",
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
      "SELECT COUNT(*) AS totalCompleted FROM orders WHERE status IN ('Delivered','Cancelled') AND shopkeeper_id = ?",
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

// SHOPKEEPER SIGNUP (accept img, upi_id, upi_qr, expo_push_token, latitude/longitude)
shopkeeperRouter.post(
  "/signup",
  upload.fields([{ name: "img", maxCount: 1 }, { name: "upi_qr", maxCount: 1 }]),
  async (req, res) => {
    try {
      const {
        name,
        email,
        password,
        phone,
        latitude,
        longitude,
        shop_name,
        upi_id,
        expo_push_token,
      } = req.body;

      if (!name || !email || !password || !phone || !shop_name) {
        return res.status(400).json({
          success: false,
          message: "Name, email, password, phone, and shop_name are required",
        });
      }

      if (password.length < 6) {
        return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
      }

      if (!/^\d{10}$/.test(phone)) {
        return res.status(400).json({ success: false, message: "Phone number must be 10 digits" });
      }

      const [existingUser] = await pool.query("SELECT id FROM shopkeepers WHERE email = ?", [email]);
      if (existingUser.length > 0) {
        return res.status(400).json({ success: false, message: "Shopkeeper already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      // Optional reverse geocode (keeps null on failure)
      let address = null;
      if (latitude && longitude) {
        try {
          const geoRes = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${process.env.GOOGLE_MAPS_API_KEY}`
          );
          const geoData = await geoRes.json();
          if (geoData.results && geoData.results.length > 0) {
            address = geoData.results[0].formatted_address;
          }
        } catch (err) {
          console.warn("Geocoding failed:", err.message);
        }
      }

      // Handle image uploads (img and upi_qr)
      let imgUrl = null;
      let upiQrUrl = null;
      try {
        const streamifier = await import("streamifier");

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
      } catch (uploadErr) {
        console.error("Signup image upload error:", uploadErr);
        return res.status(500).json({ success: false, message: "Failed to upload image(s)" });
      }

      const [result] = await pool.query(
        `INSERT INTO shopkeepers 
         (name, email, password, phone, address, shop_name, latitude, longitude, img, upi_id, upi_qr, expo_push_token, verification_status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          name,
          email,
          hashedPassword,
          phone,
          address,
          shop_name,
          latitude || null,
          longitude || null,
          imgUrl,
          upi_id || null,
          upiQrUrl,
          expo_push_token || null,
        ]
      );

      const [userRows] = await pool.query(
        "SELECT id, name, email, phone, address, shop_name, img, upi_id, upi_qr, latitude, longitude, expo_push_token, verification_status, created_at FROM shopkeepers WHERE id = ?",
        [result.insertId]
      );

      const user = userRows[0];
      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET );

      return res.json({ 
        success: true, 
        token, 
        user, 
        message: "Shopkeeper registered successfully. Your account is pending verification.",
        requiresVerification: user.verification_status === 'pending'
      });
    } catch (err) {
      console.error("Signup error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

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

    const validPass = await bcrypt.compare(password, user[0].password);
    if (!validPass) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // Check verification status
    if (user[0].verification_status === 'pending') {
      return res.status(403).json({ 
        success: false, 
        message: "Your account is pending verification. Please wait for admin approval.",
        status: 'pending'
      });
    }

    if (user[0].verification_status === 'rejected') {
      return res.status(403).json({ 
        success: false, 
        message: "Your account has been rejected. Please contact support.",
        status: 'rejected'
      });
    }

    const token = jwt.sign({ id: user[0].id }, process.env.JWT_SECRET);
    
    res.json({
      success: true,
      token,
      user: { 
        id: user[0].id, 
        email: user[0].email, 
        name: user[0].name, 
        shop_name: user[0].shop_name,
        verification_status: user[0].verification_status
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
      "SELECT id, email, name, phone, address, shop_name, img, upi_id, upi_qr, latitude, longitude, expo_push_token, verification_status, created_at FROM shopkeepers WHERE id = ?",
      [requestedId]
    );

    if (user.length === 0) {
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
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
      "SELECT id, name, email, phone, address, shop_name, img, upi_id, upi_qr, latitude, longitude, expo_push_token, verification_status, created_at FROM shopkeepers WHERE id = ?",
      [requestedId]
    );

    res.json({ success: true, user: userRows[0], message: "Profile updated successfully" });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// SHOPKEEPER ORDER ROUTES (get, update status)

// Get orders for a specific shopkeeper
shopkeeperRouter.get("/orders", verifyToken, verifyShopkeeperStatus, checkPaymentStatus, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    const { status } = req.query; // Optional filter by status

    let whereClause = "WHERE o.shopkeeper_id = ?";
    const params = [shopkeeper_id];

    if (status) {
      whereClause += " AND o.status = ?";
      params.push(status);
    }

    const [orders] = await pool.query(
      `SELECT 
        o.id AS order_id,
        o.user_id,
        o.status,
        o.total_amount,
        o.created_at,
        o.credits_earned,
        o.latitude,
        o.longitude,
        o.delivery_address,
        u.name AS customer_name,
        u.phone AS customer_phone,
        u.email AS customer_email,
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
       JOIN users u ON o.user_id = u.id
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       ${whereClause}
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      params
    );

    res.json({ success: true, orders });
  } catch (err) {
    console.error("Get shopkeeper orders error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Update order status (shopkeeper can update orders assigned to them)
shopkeeperRouter.patch("/orders/:orderId/status", verifyToken, verifyShopkeeperStatus, checkPaymentStatus, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    const { orderId } = req.params;
    const { status } = req.body;

    const orderIdNum = parseInt(orderId);
    if (isNaN(orderIdNum)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    // Validate status
    const validStatuses = ["Pending", "Processing", "Delivered", "Cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid status. Must be one of: " + validStatuses.join(", ") 
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

    // Update order status
    const [result] = await pool.query(
      "UPDATE orders SET status = ? WHERE id = ? AND shopkeeper_id = ?",
      [status, orderIdNum, shopkeeper_id]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Failed to update order status" 
      });
    }

    // Award wellness points if order is delivered
    if (status === "Delivered") {
      try {
        const [[orderDetails]] = await pool.query(
          "SELECT user_id, created_at FROM orders WHERE id = ?",
          [orderIdNum]
        );
        
        if (orderDetails) {
          const pointsData = await awardWellnessPoints(
            pool, 
            orderDetails.user_id, 
            new Date(), // delivery time (now)
            orderDetails.created_at // order creation time
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
      if (req.io) {
        req.io.to(`shop_${shopkeeper_id}`).emit("orderStatusUpdate", { orderId: orderIdNum, status });
        if (customerId) req.io.to(`customer_${customerId}`).emit("orderStatusUpdate", { orderId: orderIdNum, status });
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
            const pushResult = await sendExpoPush(token, "🛒 Order Update", `Your order #${orderIdNum} is now ${status}.`, { orderId: orderIdNum, status });
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
shopkeeperRouter.get("/products", verifyToken, verifyShopkeeperStatus, checkPaymentStatus, async (req, res) => {
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
shopkeeperRouter.post("/products", verifyToken, verifyShopkeeperStatus, checkPaymentStatus, upload.single("image"), async (req, res) => {
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
      [shop_id, name.trim(), description || null, category || null, parsedPrice, parsedStock, imageUrl]
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
shopkeeperRouter.put("/products/:id", verifyToken, verifyShopkeeperStatus, upload.single("image"), async (req, res) => {
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
    if (price != null) { const p = Number(price); if (Number.isNaN(p) || p < 0) return res.status(400).json({ success: false, message: "Invalid price" }); fields.push("price = ?"); values.push(p); }
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
// List all global products (read-only for shopkeepers)
shopkeeperRouter.get("/global-products", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, price, category, description, image, created_at FROM global_products ORDER BY created_at DESC"
    );
    res.json({ success: true, products: rows });
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

// EARNINGS ENDPOINTS

// Calculate earnings based on order amount
const calculateOrderEarning = (orderAmount) => {
  if (orderAmount <= 100) return { amount: 5, rate: "5 (≤100)" };
  if (orderAmount <= 300) return { amount: 8, rate: "8 (100-300)" };
  return { amount: 15, rate: "15 (>300)" };
};

// Get earnings data for shopkeeper
shopkeeperRouter.get("/earnings", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;

    // Get or create earnings record
    let [earningsRows] = await pool.query(
      "SELECT * FROM earnings WHERE shopkeeper_id = ?",
      [shopkeeper_id]
    );

    if (earningsRows.length === 0) {
      // Create initial earnings record
      await pool.query(
        "INSERT INTO earnings (shopkeeper_id, last_payment_date) VALUES (?, ?)",
        [shopkeeper_id, new Date()]
      );
      [earningsRows] = await pool.query(
        "SELECT * FROM earnings WHERE shopkeeper_id = ?",
        [shopkeeper_id]
      );
    }

    const earnings = earningsRows[0];

    // Calculate current cycle dates
    const lastPayment = new Date(earnings.last_payment_date);
    const nextPayment = new Date(lastPayment);
    nextPayment.setDate(nextPayment.getDate() + 15);
    
    const currentCycleStart = new Date(lastPayment);
    currentCycleStart.setDate(currentCycleStart.getDate() + 1);

    // Get delivered orders in current cycle
    const [currentCycleOrders] = await pool.query(
      `SELECT id, total_amount, created_at FROM orders 
       WHERE shopkeeper_id = ? AND status = 'Delivered' 
       AND created_at >= ? AND created_at <= ?`,
      [shopkeeper_id, currentCycleStart, new Date()]
    );

    // Calculate current cycle earnings and update order_earnings table
    let currentCycleEarnings = 0;
    for (const order of currentCycleOrders) {
      const earning = calculateOrderEarning(Number(order.total_amount));
      currentCycleEarnings += earning.amount;

      // Insert or update order_earnings record
      await pool.query(
        `INSERT INTO order_earnings 
         (order_id, shopkeeper_id, order_amount, earning_amount, earning_rate, payment_cycle_start, payment_cycle_end, is_paid)
         VALUES (?, ?, ?, ?, ?, ?, ?, FALSE)
         ON DUPLICATE KEY UPDATE 
         earning_amount = VALUES(earning_amount),
         earning_rate = VALUES(earning_rate)`,
        [order.id, shopkeeper_id, order.total_amount, earning.amount, earning.rate, currentCycleStart, nextPayment]
      );
    }

    // Update pending amount in earnings table
    await pool.query(
      "UPDATE earnings SET pending_amount = ?, next_payment_date = ? WHERE shopkeeper_id = ?",
      [currentCycleEarnings, nextPayment, shopkeeper_id]
    );

    // Calculate payment status
    const now = new Date();
    const daysUntilPayment = Math.ceil((nextPayment - now) / (1000 * 60 * 60 * 24));
    
    let paymentStatus = 'active';
    if (daysUntilPayment < 0 && currentCycleEarnings > 0) {
      paymentStatus = 'blocked';
    } else if (daysUntilPayment <= 2 && currentCycleEarnings > 0) {
      paymentStatus = 'overdue';
    } else if (daysUntilPayment <= 7 && currentCycleEarnings > 0) {
      paymentStatus = 'due_soon';
    }

    // Update payment status
    await pool.query(
      "UPDATE earnings SET payment_status = ? WHERE shopkeeper_id = ?",
      [paymentStatus, shopkeeper_id]
    );

    // Get updated earnings data
    const [updatedEarnings] = await pool.query(
      "SELECT * FROM earnings WHERE shopkeeper_id = ?",
      [shopkeeper_id]
    );

    res.json({
      success: true,
      earnings: updatedEarnings[0],
      currentCycleEarnings,
      daysUntilPayment: Math.max(0, daysUntilPayment),
      paymentStatus
    });

  } catch (err) {
    console.error("Get earnings error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Submit payment request for admin approval
shopkeeperRouter.post("/earnings/payment", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    const { amount, payment_method, transaction_id } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Valid amount is required" });
    }

    // Get current earnings
    const [earningsRows] = await pool.query(
      "SELECT * FROM earnings WHERE shopkeeper_id = ?",
      [shopkeeper_id]
    );

    if (earningsRows.length === 0) {
      return res.status(404).json({ success: false, message: "Earnings record not found" });
    }

    // Check if there's already a pending payment request
    const [pendingRequests] = await pool.query(
      "SELECT COUNT(*) as count FROM earnings_history WHERE shopkeeper_id = ? AND status = 'pending'",
      [shopkeeper_id]
    );

    if (pendingRequests[0].count > 0) {
      return res.status(400).json({ 
        success: false, 
        message: "You already have a pending payment request. Please wait for admin approval." 
      });
    }

    // Create payment request (pending status)
    await pool.query(
      `INSERT INTO earnings_history 
       (shopkeeper_id, amount, payment_method, transaction_id, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [shopkeeper_id, amount, payment_method || 'UPI', transaction_id || null]
    );

    res.json({
      success: true,
      message: "Payment request submitted successfully. Please wait for admin approval.",
      status: 'pending'
    });

  } catch (err) {
    console.error("Submit payment request error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get payment history for shopkeeper
shopkeeperRouter.get("/earnings/history", verifyToken, verifyShopkeeperStatus, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;

    const [history] = await pool.query(
      `SELECT * FROM earnings_history 
       WHERE shopkeeper_id = ? 
       ORDER BY payment_date DESC`,
      [shopkeeper_id]
    );

    res.json({
      success: true,
      history
    });

  } catch (err) {
    console.error("Get payment history error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Check if shopkeeper is blocked due to overdue payment
shopkeeperRouter.get("/earnings/status", verifyToken, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;

    const [earningsRows] = await pool.query(
      "SELECT payment_status, pending_amount, next_payment_date FROM earnings WHERE shopkeeper_id = ?",
      [shopkeeper_id]
    );

    if (earningsRows.length === 0) {
      return res.json({
        success: true,
        isBlocked: false,
        status: 'active',
        pendingAmount: 0
      });
    }

    const earnings = earningsRows[0];
    const isBlocked = earnings.payment_status === 'blocked';

    res.json({
      success: true,
      isBlocked,
      status: earnings.payment_status,
      pendingAmount: earnings.pending_amount,
      nextPaymentDate: earnings.next_payment_date
    });

  } catch (err) {
    console.error("Get earnings status error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default shopkeeperRouter;