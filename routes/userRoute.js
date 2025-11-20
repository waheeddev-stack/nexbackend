import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import { sendExpoPush } from "../utils/expoPush.js";
import dotenv from "dotenv";
import upload from "../config/upload.js";
import cloudinary from "../config/cloudinary.js";
import  verifyToken  from "../middleware/auth.js";

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

// REGISTER
userrouter.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validate inputs
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    // Check if user already exists
    const [existingUser] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (existingUser.length > 0) {
      return res.status(400).json({ success: false, message: "User already exists" });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user into database
    const [result] = await pool.query(
      "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
      [name, email, hashedPassword]
    );

    // Fetch the newly created user
  const [userRows] = await pool.query("SELECT id, name, email, store_credits, created_at FROM users WHERE id = ?", [result.insertId]);
  const user = userRows[0];

  return res.json({ success: true, user, message: "User registered successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// LOGIN
userrouter.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;

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
userrouter.get("/orders", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
    res.json({ success: true, orders: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

userrouter.post("/orders", async (req, res) => {
  try {
    const { user_id, products, total, address } = req.body;
    if (!user_id || !Array.isArray(products) || products.length === 0 || !total || !address) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // Insert order
    const [orderResult] = await pool.query(
      "INSERT INTO orders (user_id, total, address, status) VALUES (?, ?, ?, ?)",
      [user_id, total, address, "Pending"]
    );
    const orderId = orderResult.insertId;

    // Insert order items and collect product ids
    const productIds = [];
    for (const item of products) {
      await pool.query(
        "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)",
        [orderId, item.product_id, item.quantity, item.price]
      );
      productIds.push(item.product_id);
    }

    // Notify involved shopkeepers (one notification per distinct shop)
    try {
      if (productIds.length > 0) {
        // Get shop mapping for products
        const [prodRows] = await pool.query("SELECT id, shop_id, name, image FROM products WHERE id IN (?)", [productIds]);
        const productToShop = new Map(prodRows.map((p) => [p.id, p.shop_id]));

        const [shopRows] = await pool.query(
          "SELECT DISTINCT shop_id FROM products WHERE id IN (?)",
          [productIds]
        );

        const distinctShopIds = shopRows.map((r) => r.shop_id).filter(Boolean);

        // group items per shop
        const itemsByShop = new Map();
        for (const item of products) {
          const pid = item.product_id;
          const shopId = productToShop.get(pid) || null;
          if (!shopId) continue;
          if (!itemsByShop.has(shopId)) itemsByShop.set(shopId, []);
          // enrich item with product name/image if available
          const prodMeta = prodRows.find((p) => p.id === pid) || {};
          itemsByShop.get(shopId).push({
            product_id: pid,
            quantity: item.quantity,
            price: item.price,
            name: prodMeta.name || null,
            image: prodMeta.image || null,
          });
        }

        for (const shopId of distinctShopIds) {
          const shopItems = itemsByShop.get(shopId) || [];
          const shopTotal = shopItems.reduce((s, it) => s + (Number(it.price || 0) * Number(it.quantity || 0)), 0);

          // Build payload similar to shopkeeper live order structure
          const orderPayload = {
            orderId,
            total: Number(total),
            status: "Pending",
            address,
            items: shopItems,
            user_id,
            shop_id: shopId,
            shop_total: shopTotal,
            created_at: new Date().toISOString(),
          };

          // Emit socket event for live update
          try {
            if (req.io) req.io.to(`shop_${shopId}`).emit("newOrder", orderPayload);
            if (req.io) req.io.to(`customer_${user_id}`).emit("newOrder", orderPayload);
          } catch (emitErr) {
            console.warn("Socket emit failed for shop", shopId, emitErr);
          }

          // Send push notification to shopkeeper
          try {
            const [[shop]] = await pool.query("SELECT id, name, expo_push_token FROM shopkeepers WHERE id = ?", [shopId]);
            const token = shop?.expo_push_token;
            if (!token) continue;

            const result = await sendExpoPush(
              token,
              "📦 New Order Received!",
              `You have a new order (#${orderId}).`,
              { orderId, shopId }
            );

            if (result?.invalidTokens?.length) {
              await pool.query("UPDATE shopkeepers SET expo_push_token = NULL WHERE expo_push_token IN (?)", [result.invalidTokens]);
              console.warn("Cleared invalid shopkeeper tokens:", result.invalidTokens);
            }
            if (result?.nonExpoTokens?.length) {
              console.warn("Non-Expo tokens for shopkeeper:", result.nonExpoTokens);
            }
          } catch (pushErr) {
            console.error("Error sending push to shopkeeper", shopId, pushErr);
          }
        }
      }
    } catch (notifyErr) {
      console.error("Error notifying shopkeepers:", notifyErr);
    }

    res.json({ success: true, order_id: orderId, message: "Order placed successfully" });
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

export default userrouter;
