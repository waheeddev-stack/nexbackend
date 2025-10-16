import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import express from "express";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import cloudinary from "../config/cloudinary.js";
import pool from "../config/db.js";
import upload from "../config/upload.js";
import verifyToken from "../middleware/auth.js";
dotenv.config();

const shopkeeperRouter = express.Router();

shopkeeperRouter.get("/stats", verifyToken, async (req, res) => {
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

shopkeeperRouter.post("/signup", async (req, res) => {
  try {
    const { name, email, password, phone, latitude, longitude, shop_name } = req.body;

    // Validate required fields
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

    // Check if shopkeeper already exists
    const [existingUser] = await pool.query("SELECT * FROM shopkeepers WHERE email = ?", [email]);
    if (existingUser.length > 0) {
      return res.status(400).json({ success: false, message: "Shopkeeper already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Reverse geocode using fetch
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
        console.warn("Geocoding failed, saving latitude/longitude only:", err.message);
      }
    }

    // Insert new shopkeeper
    const [result] = await pool.query(
      `INSERT INTO shopkeepers 
       (name, email, password, phone, address, shop_name, latitude, longitude) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, email, hashedPassword, phone, address, shop_name, latitude || null, longitude || null]
    );

    // Fetch created shopkeeper
    const [userRows] = await pool.query(
      "SELECT id, name, email, phone, address, shop_name, latitude, longitude, created_at FROM shopkeepers WHERE id = ?",
      [result.insertId]
    );

    const user = userRows[0];

    // Generate JWT token
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });

    return res.json({ success: true, token, user, message: "Shopkeeper registered successfully" });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
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

    const validPass = await bcrypt.compare(password, user[0].password);
    if (!validPass) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user[0].id }, process.env.JWT_SECRET);
    
    res.json({
      success: true,
      token,
      user: { 
        id: user[0].id, 
        email: user[0].email, 
        name: user[0].name, 
        shop_name: user[0].shop_name 
      },
    });
  } catch (err) {
    console.error("Signin error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// SHOPKEEPER PROFILE - Fixed to require authentication
shopkeeperRouter.get("/profile/:id", verifyToken, async (req, res) => {
  try {
    const requestedId = parseInt(req.params.id);
    const authenticatedId = req.user.id;

    // Users can only access their own profile
    if (requestedId !== authenticatedId) {
      return res.status(403).json({ 
        success: false, 
        message: "Unauthorized: You can only access your own profile" 
      });
    }

    const [user] = await pool.query(
      "SELECT id, email, name, phone, address, shop_name, img, created_at FROM shopkeepers WHERE id = ?",
      [requestedId]
    );

    if (user.length === 0) {
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
    }

    // Return profile even if incomplete, frontend can handle
    res.json({ 
      success: true, 
      user: user[0],
      isComplete: !!(user[0].phone && user[0].address)
    });
  } catch (err) {
    console.error("Get profile error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// SHOPKEEPER UPDATE PROFILE - Fixed validation and security
shopkeeperRouter.put("/profile/:id", verifyToken, upload.single("img"), async (req, res) => {
  try {
    const requestedId = parseInt(req.params.id);
    const authenticatedId = req.user.id;

    // Users can only update their own profile
    if (requestedId !== authenticatedId) {
      return res.status(403).json({ 
        success: false, 
        message: "Unauthorized: You can only update your own profile" 
      });
    }

    const { name, phone, address, shop_name } = req.body;
    let imgUrl = null;

    // Validate phone number if provided
    if (phone && !/^\d{10}$/.test(phone)) {
      return res.status(400).json({ success: false, message: "Phone number must be 10 digits" });
    }

    // Handle image upload (if any)
    if (req.file) {
      try {
        const streamifier = await import('streamifier');
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
      } catch (uploadError) {
        console.error("Image upload error:", uploadError);
        return res.status(500).json({ success: false, message: "Failed to upload image" });
      }
    }

    // Dynamically build update query
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
    if (imgUrl) {
      fields.push("img = ?");
      values.push(imgUrl);
    }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields to update" });
    }

    values.push(requestedId);
    const sql = `UPDATE shopkeepers SET ${fields.join(", ")} WHERE id = ?`;
    const [updateResult] = await pool.query(sql, values);

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
    }

    // Return updated shopkeeper
    const [userRows] = await pool.query(
      "SELECT id, name, email, phone, address, shop_name, img, created_at FROM shopkeepers WHERE id = ?",
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
});

// (Inventory handled on products table in this schema — shop-specific product columns exist on products table)

// Get orders for a specific shopkeeper
shopkeeperRouter.get("/orders", verifyToken, async (req, res) => {
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
shopkeeperRouter.patch("/orders/:orderId/status", verifyToken, async (req, res) => {
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
shopkeeperRouter.get("/products", verifyToken, async (req, res) => {
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
shopkeeperRouter.post("/products", verifyToken, upload.single("image"), async (req, res) => {
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
shopkeeperRouter.put("/products/:id", verifyToken, upload.single("image"), async (req, res) => {
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
shopkeeperRouter.delete("/products/:id", verifyToken, async (req, res) => {
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
shopkeeperRouter.get("/global-products", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, price, description, image, created_at FROM global_products ORDER BY created_at DESC"
    );
    res.json({ success: true, products: rows });
  } catch (err) {
    console.error("Get global products error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Add a product into shopkeeper's catalog from global_products
// body: { global_product_id, price (optional override), stock (required) }
shopkeeperRouter.post("/products/from-global", verifyToken, async (req, res) => {
  try {
    const shop_id = req.user.id;
    const { global_product_id, price, stock } = req.body;

    if (!global_product_id) {
      return res.status(400).json({ success: false, message: "global_product_id is required" });
    }
    const parsedStock = Number(stock ?? 0);
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
      [shop_id, global_product_id, gp.name, gp.description || null, null, priceToUse, parsedStock, gp.image || null]
    );

    const [created] = await pool.query("SELECT * FROM products WHERE id = ?", [result.insertId]);
    res.status(201).json({ success: true, id: result.insertId, product: created[0], message: "Product added from global catalog" });
  } catch (err) {
    console.error("Add from global error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Update only stock for a shopkeeper's product
shopkeeperRouter.patch("/products/:id/stock", verifyToken, async (req, res) => {
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

export default shopkeeperRouter;