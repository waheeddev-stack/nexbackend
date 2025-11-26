import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import upload from "../config/upload.js";
import cloudinary from "../config/cloudinary.js";
import streamifier from "streamifier";

// Admin registration
export const registerAdmin = async (req, res) => {
  // Use constant admin credentials
  const email = process.env.ADMIN_EMAIL || "admin@admin.com";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  try {
    // Only allow registration if no admin exists
    const [exists] = await pool.query("SELECT id FROM admins WHERE email = ?", [
      email,
    ]);
    if (exists.length > 0) {
      return res
        .status(409)
        .json({ success: false, message: "Admin already exists" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO admins (email, password) VALUES (?, ?)",
      [email, hashedPassword]
    );
    res
      .status(201)
      .json({ success: true, data: { id: result.insertId, email } });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};
// Admin login
export const loginAdmin = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, message: "Email and password are required" });
  }
  try {
    const [rows] = await pool.query("SELECT * FROM admins WHERE email = ?", [
      email,
    ]);
    if (rows.length === 0) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }
    const admin = rows[0];
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }
    // Generate JWT
    const accessToken = jwt.sign({ sub: admin.id, email: admin.email }, process.env.JWT_SECRET || "secretkey", {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    });
    const refreshToken = jwt.sign({ sub: admin.id }, process.env.REFRESH_JWT_SECRET || "refreshsecret", {
      expiresIn: process.env.REFRESH_JWT_EXPIRES_IN || "7d",
    });

    // Note: admins table may not have a refresh_token column; refresh token is returned
    // to the client for mobile apps but not persisted here.
    res.json({
      success: true,
      token: accessToken,
      refreshToken,
      admin: { id: admin.id, email: admin.email },
    });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// Fetch all products (protected)
export const getAllProducts = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, price, category, description, image, created_at FROM global_products ORDER BY created_at DESC"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// create product (protected)
export const createProduct = [
  upload.single("image"),
  async (req, res) => {
    const { name, price, category, description } = req.body;
    if (!name || !price) {
      return res
        .status(400)
        .json({ success: false, message: "Name and price are required" });
    }
    let imageUrl = null;
    try {
      if (req.file) {
        const streamUpload = () =>
          new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              (error, result) => {
                if (result) resolve(result);
                else reject(error);
              }
            );
            streamifier.createReadStream(req.file.buffer).pipe(stream);
          });
        const result = await streamUpload();
        imageUrl = result.secure_url;
      }

      const [dbResult] = await pool.query(
        "INSERT INTO global_products (name, price, category, description, image) VALUES (?, ?, ?, ?, ?)",
        [name, price, category || null, description || "", imageUrl]
      );

      res.status(201).json({
        success: true,
        data: {
          id: dbResult.insertId,
          name,
          price,
          category: category || null,
          description,
          image: imageUrl,
        },
      });
    } catch (err) {
      res
        .status(500)
        .json({ success: false, message: "Server error", error: err.message });
    }
  },
];

// update product (protected)
export const updateProduct = [
  upload.single("image"),
  async (req, res) => {
    const { name, price, category, description } = req.body;
    let imageUrl = req.body.image || null;
    try {
      if (req.file) {
        const streamUpload = () =>
          new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              (error, result) => {
                if (result) resolve(result);
                else reject(error);
              }
            );
            streamifier.createReadStream(req.file.buffer).pipe(stream);
          });
        const result = await streamUpload();
        imageUrl = result.secure_url;
      }

      const [dbResult] = await pool.query(
        "UPDATE global_products SET name=?, price=?, category=?, description=?, image=? WHERE id=?",
        [
          name,
          price,
          category || null,
          description || "",
          imageUrl,
          req.params.id,
        ]
      );

      if (dbResult.affectedRows === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Global product not found" });
      }

      res.json({ success: true, message: "Global product updated" });
    } catch (err) {
      res
        .status(500)
        .json({ success: false, message: "Server error", error: err.message });
    }
  },
];

// delete product (protected)
export const deleteProduct = async (req, res) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM global_products WHERE id = ?",
      [req.params.id]
    );
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Global product not found" });
    }
    res.json({ success: true, message: "Global product deleted" });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// featch all orders (protected)
export const getAllOrders = async (req, res) => {
  try {
    const [orders] = await pool.query(
      `SELECT 
         o.id, o.user_id, o.shopkeeper_id, o.status, o.total_amount, o.credits_earned,
         o.latitude, o.longitude, o.delivery_address, o.created_at,
         u.name AS customer_name, u.email AS customer_email,
         s.shop_name, s.name AS shopkeeper_name
       FROM orders o
       JOIN users u ON o.user_id = u.id
       JOIN shopkeepers s ON o.shopkeeper_id = s.id
       ORDER BY o.created_at DESC`
    );

    const orderIds = orders.map((o) => o.id);
    let itemsMap = {};

    if (orderIds.length) {
      const [items] = await pool.query(
        `SELECT oi.order_id, oi.product_id, oi.quantity, oi.price, p.name AS product_name
         FROM order_items oi
         LEFT JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id IN (?)`,
        [orderIds]
      );
      items.forEach((it) => {
        if (!itemsMap[it.order_id]) itemsMap[it.order_id] = [];
        itemsMap[it.order_id].push(it);
      });
    }

    const result = orders.map((o) => ({ ...o, items: itemsMap[o.id] || [] }));
    res.json({ success: true, data: result });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// dashboard stats (protected)
export const getDashboardStats = async (req, res) => {
  try {
    // Shopkeepers count
    const [shopkeepers] = await pool.query(
      "SELECT COUNT(*) as count FROM shopkeepers"
    );
    // Customers count
    const [customers] = await pool.query("SELECT COUNT(*) as count FROM users");
    // Orders count and revenue
    const [ordersRows] = await pool.query(
      "SELECT COUNT(*) as count, COALESCE(SUM(total_amount),0) as revenue FROM orders"
    );
    const orders = ordersRows[0].count;
    const revenue = ordersRows[0].revenue;
    // Top products (by sales)
    const [topProducts] = await pool.query(
      `SELECT p.name, SUM(oi.quantity) as sold
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       GROUP BY oi.product_id, p.name
       ORDER BY sold DESC
       LIMIT 3`
    );
    res.json({
      success: true,
      data: {
        shopkeepers: shopkeepers[0].count,
        customers: customers[0].count,
        orders,
        revenue,
        topProducts,
      },
    });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

export const getAllshopkeepers = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, email, phone, address, shop_name, img, created_at FROM shopkeepers ORDER BY created_at DESC"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// Fetch all customers/users (protected)
export const getAllCustomers = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, email, phone, address, created_at FROM users ORDER BY created_at DESC"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};
