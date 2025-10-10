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
    
    // Get top selling product for this specific shopkeeper
    const [[topProduct]] = await pool.query(`
      SELECT p.name, SUM(oi.quantity) AS sold
      FROM order_items oi
      JOIN shop_products sp ON oi.shop_product_id = sp.id
      JOIN products p ON sp.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.shopkeeper_id = ?
      GROUP BY sp.product_id
      ORDER BY sold DESC
      LIMIT 1
    `, [shopkeeper_id]);

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

// Get global product catalog for shopkeepers
// shopkeeperRouter.get("/shop-products", async (req, res) => {
//   try {
//     const [rows] = await pool.query(
//       "SELECT id, name, description, image, category FROM products ORDER BY created_at DESC"
//     );
//     res.json({ success: true, products: rows });
//   } catch (err) {
//     console.error("Get global products error:", err);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// });

// shopkeeperRouter.post("/shop-products", verifyToken, async (req, res) => {
//   try {
//     const shop_id = req.user?.id;
//     const { product_id, price, stock } = req.body;

//     if (!shop_id || !product_id || price == null || stock == null) {
//       return res.status(400).json({ success: false, message: "Missing required fields" });
//     }

//     // Validate and coerce numeric types
//     const parsedPrice = Number(price);
//     const parsedStock = Number(stock);
    
//     if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
//       return res.status(400).json({ success: false, message: "Price must be a valid positive number" });
//     }
    
//     if (Number.isNaN(parsedStock) || parsedStock < 0) {
//       return res.status(400).json({ success: false, message: "Stock must be a valid non-negative number" });
//     }

//     // Check if product exists
//     const [productExists] = await pool.query("SELECT id FROM products WHERE id = ?", [product_id]);
//     if (productExists.length === 0) {
//       return res.status(400).json({ success: false, message: "Product does not exist" });
//     }

//     const [existing] = await pool.query(
//       "SELECT id FROM shop_products WHERE shop_id = ? AND product_id = ?",
//       [shop_id, product_id]
//     );

//     if (existing.length > 0) {
//       await pool.query(
//         "UPDATE shop_products SET price = ?, stock = ? WHERE shop_id = ? AND product_id = ?",
//         [parsedPrice, parsedStock, shop_id, product_id]
//       );
//       return res.json({ success: true, updated: true, message: "Product updated successfully" });
//     } else {
//       const [result] = await pool.query(
//         "INSERT INTO shop_products (shop_id, product_id, price, stock) VALUES (?, ?, ?, ?)",
//         [shop_id, product_id, parsedPrice, parsedStock]
//       );
//       return res.json({ success: true, id: result.insertId, updated: false, message: "Product added successfully" });
//     }
//   } catch (err) {
//     console.error("Add shop product error:", err);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// });

// shopkeeperRouter.get("/shops/:shopId/products", verifyToken, async (req, res) => {
//   try {
//     const { shopId } = req.params;
//     const requestedShopId = parseInt(shopId);
    
//     if (requestedShopId !== req.user.id) {
//       return res.status(403).json({ success: false, message: "Unauthorized" });
//     }

//     const [rows] = await pool.query(
//       `SELECT sp.id AS shop_product_id,
//               pm.id AS product_id, pm.name, pm.description, pm.image, pm.category,
//               sp.price, sp.stock
//        FROM shop_products sp
//        JOIN products pm ON sp.product_id = pm.id
//        WHERE sp.shop_id = ?
//        ORDER BY pm.name ASC`,
//       [requestedShopId]
//     );

//     res.json({ success: true, products: rows });
//   } catch (err) {
//     console.error("Get shop products error:", err);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// });

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
            'product_id', sp.product_id,
            'product_name', p.name,
            'product_image', p.image,
            'quantity', oi.quantity,
            'price', oi.price
          )
        ) AS items
       FROM orders o
       JOIN users u ON o.user_id = u.id
       JOIN order_items oi ON o.id = oi.order_id
       JOIN shop_products sp ON oi.shop_product_id = sp.id
       JOIN products p ON sp.product_id = p.id
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

// Get shopkeeper's inventory/stock levels
shopkeeperRouter.get("/inventory", verifyToken, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;

    const [inventory] = await pool.query(
      `SELECT 
        sp.id AS shop_product_id,
        sp.product_id,
        p.name AS product_name,
        p.description,
        p.image,
        p.category,
        sp.price,
        sp.stock,
        sp.created_at AS added_at
       FROM shop_products sp
       JOIN products p ON sp.product_id = p.id
       WHERE sp.shop_id = ?
       ORDER BY sp.created_at DESC`,
      [shopkeeper_id]
    );

    // Calculate low stock items (less than 10)
    const lowStockItems = inventory.filter(item => item.stock < 10);

    res.json({ 
      success: true, 
      inventory,
      totalProducts: inventory.length,
      lowStockItems: lowStockItems.length,
      lowStockProducts: lowStockItems
    });
  } catch (err) {
    console.error("Get inventory error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Update product stock/price for shopkeeper
shopkeeperRouter.put("/inventory/:shopProductId", verifyToken, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    const { shopProductId } = req.params;
    const { price, stock } = req.body;

    const shopProductIdNum = parseInt(shopProductId);
    if (isNaN(shopProductIdNum)) {
      return res.status(400).json({ success: false, message: "Invalid shop product ID" });
    }

    if (price == null && stock == null) {
      return res.status(400).json({ 
        success: false, 
        message: "At least price or stock must be provided" 
      });
    }

    // Check if shop_product belongs to this shopkeeper
    const [productCheck] = await pool.query(
      "SELECT id FROM shop_products WHERE id = ? AND shop_id = ?",
      [shopProductIdNum, shopkeeper_id]
    );

    if (productCheck.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Product not found in your inventory" 
      });
    }

    // Build dynamic update query
    const fields = [];
    const values = [];

    if (price != null) {
      const parsedPrice = Number(price);
      if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
        return res.status(400).json({ 
          success: false, 
          message: "Price must be a valid positive number" 
        });
      }
      fields.push("price = ?");
      values.push(parsedPrice);
    }

    if (stock != null) {
      const parsedStock = Number(stock);
      if (Number.isNaN(parsedStock) || parsedStock < 0) {
        return res.status(400).json({ 
          success: false, 
          message: "Stock must be a valid non-negative number" 
        });
      }
      fields.push("stock = ?");
      values.push(parsedStock);
    }

    values.push(shopProductIdNum);
    values.push(shopkeeper_id);

    const [result] = await pool.query(
      `UPDATE shop_products SET ${fields.join(", ")} WHERE id = ? AND shop_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Failed to update product" 
      });
    }

    // Return updated product info
    const [updatedProduct] = await pool.query(
      `SELECT 
        sp.id AS shop_product_id,
        sp.product_id,
        p.name AS product_name,
        p.image,
        sp.price,
        sp.stock
       FROM shop_products sp
       JOIN products p ON sp.product_id = p.id
       WHERE sp.id = ? AND sp.shop_id = ?`,
      [shopProductIdNum, shopkeeper_id]
    );

    res.json({ 
      success: true, 
      message: "Product updated successfully",
      product: updatedProduct[0]
    });
  } catch (err) {
    console.error("Update inventory error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * GET all products of the logged-in shopkeeper
 */
shopkeeperRouter.get("/api/products", verifyToken, async (req, res) => {
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
shopkeeperRouter.post("/api/products", verifyToken, async (req, res) => {
  try {
    const shop_id = req.user.id;
    const { name, description, category, price, stock, image } = req.body;

    if (!name || price == null || stock == null) {
      return res.status(400).json({ success: false, message: "Name, price, and stock are required" });
    }

    const [result] = await pool.query(
      `INSERT INTO products 
       (shop_id, name, description, category, price, stock, image) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [shop_id, name, description || "", category || "", Number(price), Number(stock), image || null]
    );

    res.json({ success: true, id: result.insertId, message: "Product added successfully" });
  } catch (err) {
    console.error("Add product error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * UPDATE product
 */
shopkeeperRouter.put("/api/products/:id", verifyToken, async (req, res) => {
  try {
    const shop_id = req.user.id;
    const { productId } = req.params;
    const { name, description, category, price, stock, image } = req.body;

    const [existing] = await pool.query(
      "SELECT * FROM products WHERE id = ? AND shop_id = ?",
      [productId, shop_id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const fields = [];
    const values = [];

    if (name) { fields.push("name = ?"); values.push(name); }
    if (description) { fields.push("description = ?"); values.push(description); }
    if (category) { fields.push("category = ?"); values.push(category); }
    if (price != null) { fields.push("price = ?"); values.push(Number(price)); }
    if (stock != null) { fields.push("stock = ?"); values.push(Number(stock)); }
    if (image) { fields.push("image = ?"); values.push(image); }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    values.push(productId, shop_id);

    await pool.query(
      `UPDATE products SET ${fields.join(", ")} WHERE id = ? AND shop_id = ?`,
      values
    );

    const [updated] = await pool.query(
      "SELECT * FROM products WHERE id = ? AND shop_id = ?",
      [productId, shop_id]
    );

    res.json({ success: true, message: "Product updated successfully", product: updated[0] });
  } catch (err) {
    console.error("Update product error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * DELETE product
 */
shopkeeperRouter.delete("/api/products/:id", verifyToken, async (req, res) => {
  try {
    const shop_id = req.user.id;
    const { productId } = req.params;

    const [existing] = await pool.query(
      "SELECT * FROM products WHERE id = ? AND shop_id = ?",
      [productId, shop_id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    await pool.query("DELETE FROM products WHERE id = ? AND shop_id = ?", [productId, shop_id]);

    res.json({ success: true, message: "Product deleted successfully" });
  } catch (err) {
    console.error("Delete product error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default shopkeeperRouter;