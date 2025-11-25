import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import { sendExpoPush } from "../utils/expoPush.js";
import upload from "../config/upload.js";
import cloudinary from "../config/cloudinary.js";

// User Registration
export const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validate inputs
    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    // Check if user already exists
    const [existingUser] = await pool.query(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );
    if (existingUser.length > 0) {
      return res
        .status(400)
        .json({ success: false, message: "User already exists" });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user into database
    const [result] = await pool.query(
      "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
      [name, email, hashedPassword]
    );

    // Fetch the newly created user
    const [userRows] = await pool.query(
      "SELECT id, name, email, store_credits, created_at FROM users WHERE id = ?",
      [result.insertId]
    );
    const user = userRows[0];

    return res.json({
      success: true,
      user,
      message: "User registered successfully",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
// user login
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const [user] = await pool.query("SELECT * FROM users WHERE email = ?", [
      email,
    ]);
    if (user.length === 0)
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });

    const validPass = await bcrypt.compare(password, user[0].password);
    if (!validPass)
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });

    const token = jwt.sign({ id: user[0].id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    res.json({
      success: true,
      token,
      user: { id: user[0].id, email: user[0].email, name: user[0].name },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getUserProfile = async (req, res) => {
  try {
    const [user] = await pool.query(
      "SELECT id, email, name, phone, address, img, store_credits, created_at FROM users WHERE id = ?",
      [req.params.id]
    );
    if (user.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    res.json({ success: true, user: user[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
export const updateUserProfile = [
  upload.single("img"),
  async (req, res) => {
    try {
      const { name, phone, address } = req.body;
      const { id } = req.params;
      let imgUrl = null;
      if (req.file) {
        // Use streamifier for cloudinary upload
        const streamifier = await import("streamifier");
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
      const sql = `UPDATE users SET ${fields.join(", ")} WHERE id = ?`;
      await pool.query(sql, values);
      const [userRows] = await pool.query(
        "SELECT id, name, email, phone, address, img, store_credits, created_at FROM users WHERE id = ?",
        [id]
      );
      if (userRows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
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
  },
];

// expo push token registration
export const registerPushToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token)
      return res
        .status(400)
        .json({ success: false, message: "token is required" });

    await pool.query("UPDATE users SET expo_push_token = ? WHERE id = ?", [
      token,
      req.user.id,
    ]);
    return res.json({ success: true, message: "Push token saved" });
  } catch (err) {
    console.error("Save user push token error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// orders
export const getorderHistory = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM orders ORDER BY created_at DESC"
    );
    res.json({ success: true, orders: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
// Get nearby shops based on user location
export const getNearbyShops = async (req, res) => {
  try {
    const { latitude, longitude, radiusKm = 2 } = req.query;
    if (!latitude || !longitude) {
      return res
        .status(400)
        .json({ success: false, message: "Missing location" });
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
    const shopIds = shops.map((s) => s.id);
    const [products] = await pool.query(
      `SELECT id AS product_id, shop_id, name, description, image, category, price, stock, created_at
       FROM products
       WHERE shop_id IN (?)
       ORDER BY created_at DESC`,
      [shopIds]
    );

    // Group products under their shop
    const shopsWithProducts = shops.map((shop) => ({
      ...shop,
      products: products.filter((p) => p.shop_id === shop.id),
    }));

    res.json({ success: true, shops: shopsWithProducts });
  } catch (err) {
    console.error("Nearby shops error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const refreshUserToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.cookies || req.body;
    if (!refreshToken)
      return res.status(401).json({ error: "No refresh token" });
    let payload;
    try {
      payload = jwt.verify(refreshToken, process.env.REFRESH_JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }
    const [rows] = await pool.execute(
      "SELECT id FROM users WHERE id = ? AND refresh_token = ?",
      [payload.sub, refreshToken]
    );
    if (!rows.length)
      return res.status(401).json({ error: "Invalid refresh token" });
    const newToken = jwt.sign({ sub: payload.sub }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "15m",
    });
    res.cookie("token", newToken, {
      ...COOKIE_OPTIONS,
      maxAge: 15 * 60 * 1000,
    });
    return res.json({ message: "Token refreshed" });
  } catch (err) {
    next(err);
  }
};
