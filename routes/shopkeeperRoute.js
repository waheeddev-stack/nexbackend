import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import dotenv from "dotenv";
import upload from "../config/upload.js";
import cloudinary from "../config/cloudinary.js";
import verifyToken from "../middleware/auth.js";
import fetch from "node-fetch";
dotenv.config();

const shopkeeperRouter = express.Router();

shopkeeperRouter.get("/stats", verifyToken, async (req, res) => {
  try {
    const [[topProduct]] = await pool.query(`
      SELECT p.name, SUM(oi.quantity) AS sold
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      GROUP BY oi.product_id
      ORDER BY sold DESC
      LIMIT 1
    `);

    const [[totalSales]] = await pool.query(
      "SELECT SUM(total_amount) AS totalSales FROM orders WHERE status='Delivered'"
    );
    const [[totalDelivered]] = await pool.query(
      "SELECT COUNT(*) AS totalDelivered FROM orders WHERE status='Delivered'"
    );
    const [[totalPending]] = await pool.query(
      "SELECT COUNT(*) AS totalPending FROM orders WHERE status='Pending'"
    );
    const [[totalCancelled]] = await pool.query(
      "SELECT COUNT(*) AS totalCancelled FROM orders WHERE status='Cancelled'"
    );
    const [[totalCompleted]] = await pool.query(
      "SELECT COUNT(*) AS totalCompleted FROM orders WHERE status IN ('Delivered','Cancelled')"
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
    console.error(err);
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
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});


// SHOPKEEPER LOGIN
shopkeeperRouter.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;
    const [user] = await pool.query(
      "SELECT * FROM shopkeepers WHERE email = ?",
      [email]
    );
    if (user.length === 0)
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    const validPass = await bcrypt.compare(password, user[0].password);
    if (!validPass)
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    const token = jwt.sign({ id: user[0].id }, process.env.JWT_SECRET);
    res.json({
      success: true,
      token,
      user: { id: user[0].id, email: user[0].email },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// SHOPKEEPER PROFILE
shopkeeperRouter.get("/profile/:id", async (req, res) => {
  try {
    const [user] = await pool.query(
      "SELECT id, email, name, phone, address, shop_name, img, created_at FROM shopkeepers WHERE id = ?",
      [req.params.id]
    );

    if (user.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Shopkeeper not found" });
    }
    if (!user[0].phone || !user[0].address) {
      return res.status(400).json({
        success: false,
        message: "Shopkeeper profile is incomplete (phone/address missing).",
        user: user[0],
      });
    }

    res.json({ success: true, user: user[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// SHOPKEEPER UPDATE PROFILE
shopkeeperRouter.put("/profile/:id", upload.single("img"), async (req, res) => {
  try {
    const { name, phone, address, shop_name } = req.body;
    const { id } = req.params;
    let imgUrl = null;
    //validate phone number and address if provided
    if (phone && !/^\d{10}$/.test(phone)) {
      return res
        .status(400)
        .json({ success: false, message: "Phone number must be 10 digits" });
    }
    // if (address && address.length < 6) {
    //       return res
    //         .status(400)
    //         .json({
    //           success: false,
    //           message: "Address must be at least 10 characters",
    //         });
    //     }

    if (!phone || !address) {
      return res.status(400).json({
        success: false,
        message: "Phone number and address are required.",
      });
    }

    // ✅ Handle image upload (if any)
    if (req.file) {
      await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "shopkeepers" },
          (error, result) => {
            if (error) return reject(error);
            imgUrl = result.secure_url;
            resolve();
          }
        );
        stream.end(req.file.buffer);
      });
    }

    // ✅ Dynamically build update query
    const fields = [];
    const values = [];

    if (name) {
      fields.push("name = ?");
      values.push(name);
    }
    if (phone) {
      fields.push("phone = ?");
      values.push(phone);
    }
    if (address) {
      fields.push("address = ?");
      values.push(address);
    }
    if (shop_name) {
      // ✅ added shop_name
      fields.push("shop_name = ?");
      values.push(shop_name);
    }
    if (imgUrl) {
      fields.push("img = ?");
      values.push(imgUrl);
    }

    if (fields.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No fields to update" });
    }

    values.push(id);
    const sql = `UPDATE shopkeepers SET ${fields.join(", ")} WHERE id = ?`;
    await pool.query(sql, values);

    // ✅ Return updated shopkeeper
    const [userRows] = await pool.query(
      "SELECT id, name, email, phone, address, shop_name, img, created_at FROM shopkeepers WHERE id = ?",
      [id]
    );

    if (userRows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Shopkeeper not found" });
    }

    res.json({
      success: true,
      user: userRows[0],
      message: "Profile updated successfully",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get global product catalog for shopkeepers
shopkeeperRouter.get("/shop-products", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, description, image, category FROM products ORDER BY created_at DESC"
    );
    res.json({ success: true, products: rows });
  } catch (err) {
    console.error("Get global products error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

shopkeeperRouter.post("/shop-products", verifyToken, async (req, res) => {
  try {
    const shop_id = req.user?.id;
    const { product_id, price, stock } = req.body;

    if (!shop_id || !product_id || price == null || stock == null) {
      return res
        .status(400)
        .json({ success: false, message: "Missing fields" });
    }

    // Optional: coerce numeric types (and validate)
    const parsedPrice = Number(price);
    const parsedStock = Number(stock);
    if (Number.isNaN(parsedPrice) || Number.isNaN(parsedStock)) {
      return res
        .status(400)
        .json({ success: false, message: "Price and stock must be numbers" });
    }

    const [existing] = await pool.query(
      "SELECT id FROM shop_products WHERE shop_id = ? AND product_id = ?",
      [shop_id, product_id]
    );

    if (existing.length > 0) {
      await pool.query(
        "UPDATE shop_products SET price = ?, stock = ? WHERE shop_id = ? AND product_id = ?",
        [parsedPrice, parsedStock, shop_id, product_id]
      );
      return res.json({ success: true, updated: true });
    } else {
      const [result] = await pool.query(
        "INSERT INTO shop_products (shop_id, product_id, price, stock) VALUES (?, ?, ?, ?)",
        [shop_id, product_id, parsedPrice, parsedStock]
      );
      return res.json({ success: true, id: result.insertId, updated: false });
    }
  } catch (err) {
    console.error("Add shop product error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

shopkeeperRouter.get(
  "/shops/:shopId/products",
  verifyToken,
  async (req, res) => {
    try {
      const { shopId } = req.params;
      if (parseInt(shopId) !== req.user.id) {
        return res
          .status(403)
          .json({ success: false, message: "Unauthorized" });
      }

      const [rows] = await pool.query(
        `SELECT sp.id AS shop_product_id,
              pm.id AS product_id, pm.name, pm.description, pm.image, pm.category,
              sp.price, sp.stock
       FROM shop_products sp
       JOIN products pm ON sp.product_id = pm.id
       WHERE sp.shop_id = ?`,
        [shopId]
      );

      res.json({ success: true, products: rows });
    } catch (err) {
      console.error("Get shop products error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);
export default shopkeeperRouter;
