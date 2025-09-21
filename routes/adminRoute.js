import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import verifyToken from "../middleware/auth.js";

import pool from "../config/db.js";
import upload from "../config/upload.js";
import cloudinary from "../config/cloudinary.js";
import streamifier from "streamifier";

const adminRouter = express.Router();

// Fetch all shopkeepers (protected)
adminRouter.get("/shopkeepers", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, email, phone, address, shop_name, img, created_at FROM shopkeepers ORDER BY created_at DESC"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Fetch all customers/users (protected)
adminRouter.get("/customers", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, email, phone, address, created_at FROM users ORDER BY created_at DESC"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Admin Registration (only via backend, not frontend)
adminRouter.post("/register", async (req, res) => {
  // Use constant admin credentials
  const email = process.env.ADMIN_EMAIL || "admin@admin.com";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  try {
    // Only allow registration if no admin exists
    const [exists] = await pool.query("SELECT id FROM admins WHERE email = ?", [
      email,
    ]);
    if (exists.length > 0) {
      return res.status(409).json({ success: false, message: "Admin already exists" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO admins (email, password) VALUES (?, ?)",
      [email, hashedPassword]
    );
    res.status(201).json({ success: true, data: { id: result.insertId, email } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// List all admins (protected)
adminRouter.get("/", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, email, created_at FROM admins");
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Example protected route
// adminRouter.get("/profile", verifyToken, async (req, res) => {
//   try {
//     const [rows] = await pool.query(
//       "SELECT id, email, created_at FROM admins WHERE id = ?",
//       [req.admin.id]
//     );
//     if (rows.length === 0) {
//       return res.status(404).json({ success: false, message: "Admin not found" });
//     }
//     res.json({ success: true, data: rows[0] });
//   } catch (err) {
//     res.status(500).json({ success: false, message: "Server error", error: err.message });
//   }
// });


adminRouter.get("/dashboard", verifyToken, async (req, res) => {
  try {
    // Shopkeepers count
    const [shopkeepers] = await pool.query(
      "SELECT COUNT(*) as count FROM shopkeepers"
    );
    // Customers count
    const [customers] = await pool.query("SELECT COUNT(*) as count FROM users");
    // Orders count and revenue
    const [ordersRows] = await pool.query("SELECT COUNT(*) as count, COALESCE(SUM(total_amount),0) as revenue FROM orders");
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
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

adminRouter.get("/products", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM products ORDER BY created_at DESC"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Add a new product with image upload (category as string)
// adminRouter.post(
//   "/products",
//   verifyToken,
//   upload.single("image"),
//   async (req, res) => {
//     const { name, price, stock, description, category } = req.body;
//     if (!name || !price) {
//       return res.status(400).json({ message: "Name and price are required" });
//     }
//     let imageUrl = null;
//     try {
//       if (req.file) {
//         const streamUpload = () =>
//           new Promise((resolve, reject) => {
//             const stream = cloudinary.uploader.upload_stream(
//               (error, result) => {
//                 if (result) resolve(result);
//                 else reject(error);
//               }
//             );
//             streamifier.createReadStream(req.file.buffer).pipe(stream);
//           });
//         const result = await streamUpload();
//         imageUrl = result.secure_url;
//       }
//       const [dbResult] = await pool.query(
//         "INSERT INTO products (name, price, stock, description, image, category) VALUES (?, ?, ?, ?, ?, ?)",
//         [name, price, stock || 0, description || "", imageUrl, category || null]
//       );
//       res.status(201).json({
//         id: dbResult.insertId,
//         name,
//         price,
//         stock,
//         description,
//         image: imageUrl,
//         category,
//       });
//     } catch (err) {
//       res.status(500).json({ success: false, message: "Server error", error: err.message });
//     }
//   }
// );

// Update a product (category as string)
// adminRouter.put(
//   "/products/:id",
//   verifyToken,
//   upload.single("image"),
//   async (req, res) => {
//     const { name, price, stock, description, category } = req.body;
//     let imageUrl = req.body.image || null;
//     try {
//       if (req.file) {
//         const streamUpload = () =>
//           new Promise((resolve, reject) => {
//             const stream = cloudinary.uploader.upload_stream(
//               (error, result) => {
//                 if (result) resolve(result);
//                 else reject(error);
//               }
//             );
//             streamifier.createReadStream(req.file.buffer).pipe(stream);
//           });
//         const result = await streamUpload();
//         imageUrl = result.secure_url;
//       }
//       const [dbResult] = await pool.query(
//         "UPDATE products SET name=?, price=?, stock=?, description=?, image=?, category=? WHERE id=?",
//         [
//           name,
//           price,
//           stock,
//           description,
//           imageUrl,
//           category || null,
//           req.params.id,
//         ]
//       );
//       if (dbResult.affectedRows === 0) {
//         return res.status(404).json({ success: false, message: "Product not found" });
//       }
//       res.json({ message: "Product updated" });
//     } catch (err) {
//       res.status(500).json({ success: false, message: "Server error", error: err.message });
//     }
//   }
// );

// Delete a product
adminRouter.delete("/products/:id", verifyToken, async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM products WHERE id=?", [
      req.params.id,
    ]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    res.json({ success: true, message: "Product deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Get all categories
adminRouter.get("/categories", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM categories ORDER BY created_at DESC"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Add a new category
adminRouter.post("/categories", verifyToken, async (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, message: "Category name is required" });
  }
  try {
    const [result] = await pool.query(
      "INSERT INTO categories (name, description) VALUES (?, ?)",
      [name, description || ""]
    );
    res.status(201).json({ success: true, data: { id: result.insertId, name, description } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Update a category
adminRouter.put("/categories/:id", verifyToken, async (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, message: "Category name is required" });
  }
  try {
    const [result] = await pool.query(
      "UPDATE categories SET name=?, description=? WHERE id=?",
      [name, description || "", req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }
    res.json({ success: true, message: "Category updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Delete a category
adminRouter.delete("/categories/:id", verifyToken, async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM categories WHERE id=?", [
      req.params.id,
    ]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }
    res.json({ success: true, message: "Category deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Get admin by ID (protected) - keep this at the end
adminRouter.get("/:id", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, email, created_at FROM admins WHERE id = ?",
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Update admin email or password (protected)
adminRouter.put("/:id", verifyToken, async (req, res) => {
  const { email, password } = req.body;
  if (!email && !password) {
    return res.status(400).json({ success: false, message: "Nothing to update" });
  }
  try {
    let updateFields = [];
    let params = [];
    if (email) {
      updateFields.push("email = ?");
      params.push(email);
    }
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateFields.push("password = ?");
      params.push(hashedPassword);
    }
    params.push(req.params.id);
    const [result] = await pool.query(
      `UPDATE admins SET ${updateFields.join(", ")} WHERE id = ?`,
      params
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }
    res.json({ success: true, message: "Admin updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Delete admin (protected)
adminRouter.delete("/:id", verifyToken, async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM admins WHERE id = ?", [
      req.params.id,
    ]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }
    res.json({ success: true, message: "Admin deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Admin Login
adminRouter.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password are required" });
  }
  try {
    const [rows] = await pool.query("SELECT * FROM admins WHERE email = ?", [
      email,
    ]);
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
    const admin = rows[0];
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
    // Generate JWT
    const token = jwt.sign(
      { id: admin.id, email: admin.email },
      process.env.JWT_SECRET || "secretkey"
    );
    res.json({ success: true, token, admin: { id: admin.id, email: admin.email } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Example protected route
adminRouter.get("/profile", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, email, created_at FROM admins WHERE id = ?",
      [req.admin.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});


// Add a new product with image upload (category as string)
// adminRouter.post("/products", verifyToken, upload.single("image"), async (req, res) => {
//   const { name, price, stock, description, category } = req.body;
//   if (!name || !price) {
//     return res.status(400).json({ message: "Name and price are required" });
//   }
//   let imageUrl = null;
//   try {
//     if (req.file) {
//       const streamUpload = () =>
//         new Promise((resolve, reject) => {
//           const stream = cloudinary.uploader.upload_stream((error, result) => {
//             if (result) resolve(result);
//             else reject(error);
//           });
//           streamifier.createReadStream(req.file.buffer).pipe(stream);
//         });
//       const result = await streamUpload();
//       imageUrl = result.secure_url;
//     }
//     const [dbResult] = await pool.query(
//       "INSERT INTO products (name, price, stock, description, image, category) VALUES (?, ?, ?, ?, ?, ?)",
//       [name, price, stock || 0, description || '', imageUrl, category || null]
//     );
//     res.status(201).json({ id: dbResult.insertId, name, price, stock, description, image: imageUrl, category });
//   } catch (err) {
//     res.status(500).json({ success: false, message: "Server error", error: err.message });
//   }
// });

adminRouter.post(
  "/products",
  verifyToken,
  upload.single("image"),
  async (req, res) => {
    const { name, description, category } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: "Name is required" });
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
        "INSERT INTO products (name, description, image, category) VALUES (?, ?, ?, ?)",
        [name, description || "", imageUrl, category || null]
      );

      res.status(201).json({
        success: true,
        data: {
          id: dbResult.insertId,
          name,
          description,
          image: imageUrl,
          category,
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
  }
);

adminRouter.put(
  "/products/:id",
  verifyToken,
  upload.single("image"),
  async (req, res) => {
    const { name, description, category } = req.body;
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
        "UPDATE products SET name=?, description=?, image=?, category=? WHERE id=?",
        [name, description, imageUrl, category || null, req.params.id]
      );

      if (dbResult.affectedRows === 0) {
        return res.status(404).json({ success: false, message: "Product not found" });
      }

      res.json({ success: true, message: "Product updated" });
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
  }
);

// Delete a product
adminRouter.delete("/products/:id", verifyToken, async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM products WHERE id=?", [
      req.params.id,
    ]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    res.json({ success: true, message: "Product deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

export default adminRouter;
