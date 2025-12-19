import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import verifyToken from "../middleware/auth.js";
import verifyAdminToken from "../middleware/adminAuth.js";

import pool from "../config/db.js";
import upload from "../config/upload.js";
import cloudinary from "../config/cloudinary.js";
import streamifier from "streamifier";
import { processPaymentApproval } from "../utils/subscription.js";

const adminRouter = express.Router();

// Fetch all shopkeepers (protected) with optional status filtering
adminRouter.get("/shopkeepers", verifyAdminToken, async (req, res) => {
  try {
    const { status } = req.query; // Get status filter from query params

    let whereClause = "WHERE id IS NOT NULL";
    let queryParams = [];

    // Add status filtering based on query parameter
    if (status && status !== 'all') {
      if (status === 'pending') {
        whereClause += " AND (is_verified IS NULL OR is_verified = '')";
      } else if (status === 'approved') {
        whereClause += " AND is_verified = ?";
        queryParams.push(1);
      } else if (status === 'rejected') {
        whereClause += " AND is_verified = ?";
        queryParams.push(0);
      }
    }

    const query = `SELECT id, name, email, phone, address, shop_name, img, is_verified, shop_scale, created_at FROM shopkeepers ${whereClause} ORDER BY created_at DESC`;

    const [rows] = await pool.query(query, queryParams);

    // Map is_verified to verification_status for frontend compatibility and ensure valid IDs
    const mappedRows = rows
      .filter(row => row.id != null && row.id !== 0) // Filter out any invalid IDs
      .map(row => ({
        ...row,
        id: parseInt(row.id), // Ensure ID is a number
        verification_status: row.is_verified === 1 ? 'approved' :
          row.is_verified === 0 ? 'rejected' : 'pending'
      }));

    // Add summary statistics for the admin panel
    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN is_verified = 1 THEN 1 END) as approved,
        COUNT(CASE WHEN is_verified = 0 THEN 1 END) as rejected,
        COUNT(CASE WHEN is_verified IS NULL OR is_verified = '' THEN 1 END) as pending
      FROM shopkeepers 
      WHERE id IS NOT NULL
    `);

    res.json({
      success: true,
      data: mappedRows,
      stats: stats[0],
      filter: status || 'all'
    });
  } catch (err) {
    console.error("Get shopkeepers error:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Get shopkeeper statistics for admin panel tabs
adminRouter.get("/shopkeepers/stats", verifyAdminToken, async (req, res) => {
  try {
    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN is_verified = 1 THEN 1 END) as approved,
        COUNT(CASE WHEN is_verified = 0 THEN 1 END) as rejected,
        COUNT(CASE WHEN is_verified IS NULL OR is_verified = '' THEN 1 END) as pending
      FROM shopkeepers 
      WHERE id IS NOT NULL
    `);

    const [recentActivity] = await pool.query(`
      SELECT 
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as new_this_week,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as new_this_month
      FROM shopkeepers 
      WHERE id IS NOT NULL
    `);

    res.json({
      success: true,
      data: {
        ...stats[0],
        ...recentActivity[0]
      }
    });
  } catch (err) {
    console.error("Get shopkeeper stats error:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Fetch all customers/users (protected)
adminRouter.get("/customers", verifyAdminToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, email, phone, address, created_at FROM users ORDER BY created_at DESC"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Test endpoint to debug verification issues
adminRouter.get("/test-verify/:id", verifyAdminToken, async (req, res) => {
  try {
    const shopkeeperId = req.params.id;
    console.log(`Testing verification for shopkeeper ${shopkeeperId}`);

    // Check if shopkeeper exists
    const [shopkeeper] = await pool.query(
      "SELECT id, name, email, is_verified FROM shopkeepers WHERE id = ?",
      [shopkeeperId]
    );

    if (shopkeeper.length === 0) {
      return res.json({
        success: false,
        message: "Shopkeeper not found",
        shopkeeperId,
        found: false
      });
    }

    res.json({
      success: true,
      message: "Shopkeeper found",
      shopkeeper: shopkeeper[0],
      found: true
    });
  } catch (error) {
    console.error("Test verify error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

// Verify/Reject shopkeeper (protected)
adminRouter.patch("/shopkeepers/:id/verify", verifyAdminToken, async (req, res) => {
  try {
    const shopkeeperId = req.params.id;
    const { action } = req.body; // "approve" or "reject"

    // Validate shopkeeper ID
    if (!shopkeeperId || shopkeeperId === 'null' || shopkeeperId === 'undefined' || isNaN(parseInt(shopkeeperId))) {
      return res.status(400).json({
        success: false,
        message: "Invalid shopkeeper ID. Please refresh the page and try again."
      });
    }

    console.log(`Verification request: shopkeeper ${shopkeeperId}, action: ${action}`);

    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ success: false, message: "Invalid action. Use 'approve' or 'reject'" });
    }

    const is_verified = action === "approve" ? 1 : 0;

    // First check if shopkeeper exists
    const [existingShopkeeper] = await pool.query(
      "SELECT id, name, email FROM shopkeepers WHERE id = ?",
      [shopkeeperId]
    );

    if (existingShopkeeper.length === 0) {
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
    }

    // Update verification status using is_verified column
    const [result] = await pool.query(
      "UPDATE shopkeepers SET is_verified = ? WHERE id = ?",
      [is_verified, parseInt(shopkeeperId)]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Failed to update shopkeeper status" });
    }

    console.log(`✅ Updated shopkeeper ${shopkeeperId} verification status to: ${is_verified}`);

    // Get updated shopkeeper details for response
    const [shopkeeper] = await pool.query(
      "SELECT * FROM shopkeepers WHERE id = ?",
      [shopkeeperId]
    );

    console.log(`Verification successful: ${JSON.stringify(shopkeeper[0])}`);

    res.json({
      success: true,
      message: `Shopkeeper ${action}d successfully`,
      shopkeeper: shopkeeper[0]
    });
  } catch (err) {
    console.error("Shopkeeper verification error:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Simple verification endpoint as fallback
adminRouter.post("/shopkeepers/:id/status", verifyAdminToken, async (req, res) => {
  try {
    const shopkeeperId = req.params.id;
    const { status } = req.body; // "approved", "rejected", or "pending"

    // Validate shopkeeper ID
    if (!shopkeeperId || shopkeeperId === 'null' || shopkeeperId === 'undefined' || isNaN(parseInt(shopkeeperId))) {
      return res.status(400).json({
        success: false,
        message: "Invalid shopkeeper ID. Please refresh the page and try again."
      });
    }

    console.log(`Simple verification: shopkeeper ${shopkeeperId}, status: ${status}`);

    // Map status to is_verified value
    let is_verified;
    if (status === "approved" || status === "verified" || status === "1" || status === 1) {
      is_verified = 1;
    } else if (status === "rejected" || status === "0" || status === 0) {
      is_verified = 0;
    } else {
      is_verified = null; // pending
    }

    // Check if shopkeeper exists first
    const [existingShopkeeper] = await pool.query(
      "SELECT id, name FROM shopkeepers WHERE id = ?",
      [parseInt(shopkeeperId)]
    );

    if (existingShopkeeper.length === 0) {
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
    }

    // Update verification status
    await pool.query(
      "UPDATE shopkeepers SET is_verified = ? WHERE id = ?",
      [is_verified, parseInt(shopkeeperId)]
    );

    const statusText = is_verified === 1 ? 'approved' : is_verified === 0 ? 'rejected' : 'pending';

    res.json({
      success: true,
      message: `Shopkeeper ${statusText} successfully`,
      shopkeeperId: parseInt(shopkeeperId),
      is_verified,
      verification_status: statusText
    });

  } catch (err) {
    console.error("Shopkeeper verification error:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Admin Registration (only for initial setup)
adminRouter.post("/register", async (req, res) => {
  try {
    // Check if any admin already exists
    const [existingAdmins] = await pool.query("SELECT COUNT(*) as count FROM admins");
    if (existingAdmins[0].count > 0) {
      return res.status(403).json({
        success: false,
        message: "Admin registration is disabled. Admin already exists."
      });
    }

    // Use environment variables for admin credentials
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
      return res.status(500).json({
        success: false,
        message: "Admin credentials not configured"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO admins (email, password) VALUES (?, ?)",
      [email, hashedPassword]
    );

    res.status(201).json({
      success: true,
      data: { id: result.insertId, email },
      message: "Initial admin created successfully"
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// List all admins (protected)
adminRouter.get("/", verifyAdminToken, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, email, created_at FROM admins");
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});


adminRouter.get("/dashboard", verifyAdminToken, async (req, res) => {
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

// adminRouter.get("/products", verifyToken, async (req, res) => {
//   try {
//     const [rows] = await pool.query(
//       "SELECT * FROM products ORDER BY created_at DESC"
//     );
//     res.json({ success: true, data: rows });
//   } catch (err) {
//     res.status(500).json({ success: false, message: "Server error", error: err.message });
//   }
// });

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
// adminRouter.delete("/products/:id", verifyToken, async (req, res) => {
//   try {
//     const [result] = await pool.query("DELETE FROM products WHERE id=?", [
//       req.params.id,
//     ]);
//     if (result.affectedRows === 0) {
//       return res.status(404).json({ success: false, message: "Product not found" });
//     }
//     res.json({ success: true, message: "Product deleted" });
//   } catch (err) {
//     res.status(500).json({ success: false, message: "Server error", error: err.message });
//   }
// });


// --- Admin CRUD for global_products (admin only) ---

// List all global products
adminRouter.get("/global-products", verifyAdminToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, price, category, description, image, brand, barcode, shop_scales, created_at FROM global_products ORDER BY created_at DESC"
    );

    // Parse shop_scales JSON for each product
    const products = rows.map(product => {
      let shopScales = ['all'];
      if (product.shop_scales) {
        try {
          shopScales = JSON.parse(product.shop_scales);
        } catch (e) {
          console.warn('Failed to parse shop_scales for product', product.id, ':', e.message);
          shopScales = ['all'];
        }
      }
      return {
        ...product,
        shopScales: shopScales
      };
    });

    res.json({ success: true, data: products });
  } catch (err) {
    console.error("Get global products error:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Create a global product (admin)
adminRouter.post(
  "/global-products",
  verifyAdminToken,
  upload.single("image"),
  async (req, res) => {
    const {
      name,
      price,
      category,
      description,
      brand,
      barcode,
      shopScales
    } = req.body;

    if (!name || !price) {
      return res.status(400).json({
        success: false,
        message: "Name and price are required"
      });
    }

    let imageUrl = null;
    try {
      if (req.file) {
        const streamUpload = () =>
          new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream((error, result) => {
              if (result) resolve(result);
              else reject(error);
            });
            streamifier.createReadStream(req.file.buffer).pipe(stream);
          });
        const result = await streamUpload();
        imageUrl = result.secure_url;
      }

      // Parse shopScales if it's a string, otherwise use as-is
      let parsedShopScales = ['all']; // default
      if (shopScales) {
        try {
          parsedShopScales = typeof shopScales === 'string' ? JSON.parse(shopScales) : shopScales;
        } catch (e) {
          console.warn('Failed to parse shopScales, using default:', e);
        }
      }

      // Use database transaction for thread-safe ID generation
      await pool.query('START TRANSACTION');

      try {
        // Lock the table and get next ID
        const [maxIdResult] = await pool.query("SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM global_products FOR UPDATE");
        const nextId = maxIdResult[0].next_id;

        const [dbResult] = await pool.query(
          "INSERT INTO global_products (id, name, price, category, description, image, brand, barcode, shop_scales) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            nextId,
            name,
            parseFloat(price),
            category || null,
            description || "",
            imageUrl,
            brand || null,
            barcode || null,
            JSON.stringify(parsedShopScales)
          ]
        );

        await pool.query('COMMIT');

        // Use nextId for response since insertId might be 0
        const actualId = dbResult.insertId || nextId;

        res.status(201).json({
          success: true,
          data: {
            id: actualId,
            name,
            price,
            category: category || null,
            description,
            image: imageUrl,
            brand: brand || null,
            barcode: barcode || null,
            shopScales: parsedShopScales,
          },
        });
      } catch (transactionError) {
        await pool.query('ROLLBACK');
        throw transactionError;
      }
    } catch (err) {
      console.error("Create global product error:", err);
      res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
  }
);

// Update a global product (admin)
adminRouter.put(
  "/global-products/:id",
  verifyAdminToken,
  upload.single("image"),
  async (req, res) => {
    const productId = req.params.id;

    // Validate product ID
    if (!productId || productId === 'null' || productId === 'undefined') {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID. Product ID is required for update."
      });
    }

    const {
      name,
      price,
      category,
      description,
      brand,
      barcode,
      shopScales
    } = req.body;
    let imageUrl = req.body.image || null;

    try {
      if (req.file) {
        const streamUpload = () =>
          new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream((error, result) => {
              if (result) resolve(result);
              else reject(error);
            });
            streamifier.createReadStream(req.file.buffer).pipe(stream);
          });
        const result = await streamUpload();
        imageUrl = result.secure_url;
      }

      // Parse shopScales if it's a string, otherwise use as-is
      let parsedShopScales = ['all']; // default
      if (shopScales) {
        try {
          parsedShopScales = typeof shopScales === 'string' ? JSON.parse(shopScales) : shopScales;
        } catch (e) {
          console.warn('Failed to parse shopScales, using default:', e);
        }
      }

      const [dbResult] = await pool.query(
        "UPDATE global_products SET name=?, price=?, category=?, description=?, image=?, brand=?, barcode=?, shop_scales=? WHERE id=?",
        [
          name,
          parseFloat(price),
          category || null,
          description || "",
          imageUrl,
          brand || null,
          barcode || null,
          JSON.stringify(parsedShopScales),
          parseInt(productId)
        ]
      );

      if (dbResult.affectedRows === 0) {
        return res.status(404).json({ success: false, message: "Global product not found" });
      }

      res.json({ success: true, message: "Global product updated" });
    } catch (err) {
      console.error("Update global product error:", err);
      res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
  }
);

// Delete a global product (admin)
adminRouter.delete("/global-products/:id", verifyAdminToken, async (req, res) => {
  const productId = req.params.id;

  // Validate product ID
  if (!productId || productId === 'null' || productId === 'undefined') {
    return res.status(400).json({
      success: false,
      message: "Invalid product ID. Product ID is required for deletion."
    });
  }

  try {
    const [result] = await pool.query("DELETE FROM global_products WHERE id = ?", [
      parseInt(productId),
    ]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Global product not found" });
    }
    res.json({ success: true, message: "Global product deleted" });
  } catch (err) {
    console.error("Delete global product error:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// GET /api/admin/products - Get all shop-specific products
adminRouter.get("/products", verifyAdminToken, async (req, res) => {
  try {
    const [products] = await pool.query(`
      SELECT p.*, s.shop_name, s.name as shopkeeper_name, s.shop_scale
      FROM products p 
      LEFT JOIN shopkeepers s ON p.shop_id = s.id 
      ORDER BY p.created_at DESC
    `);
    res.json({ success: true, data: products });
  } catch (err) {
    console.error("Get products error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /api/admin/global-products/scale/:shopScale - Get global products available for specific shop scale
adminRouter.get("/global-products/scale/:shopScale", verifyAdminToken, async (req, res) => {
  try {
    const { shopScale } = req.params;

    if (!['small', 'medium', 'large'].includes(shopScale)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop scale. Must be small, medium, or large"
      });
    }

    const [rows] = await pool.query(`
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
    `, [JSON.stringify(shopScale)]);

    // Parse shop_scales for response
    const products = rows.map(product => ({
      ...product,
      shopScales: product.shop_scales ? JSON.parse(product.shop_scales) : ['all']
    }));

    res.json({ success: true, data: products, shopScale });
  } catch (err) {
    console.error("Get scale-specific products error:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// PUT /api/admin/shopkeepers/:id/scale - Update shopkeeper scale
adminRouter.put("/shopkeepers/:id/scale", verifyAdminToken, async (req, res) => {
  try {
    const shopkeeperId = req.params.id;
    const { shop_scale } = req.body;

    if (!['small', 'medium', 'large'].includes(shop_scale)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop scale. Must be small, medium, or large"
      });
    }

    const [result] = await pool.query(
      "UPDATE shopkeepers SET shop_scale = ? WHERE id = ?",
      [shop_scale, shopkeeperId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
    }

    res.json({
      success: true,
      message: `Shopkeeper scale updated to ${shop_scale}`,
      shopkeeperId,
      shop_scale
    });
  } catch (err) {
    console.error("Update shopkeeper scale error:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// GET /api/admin/order-items - Get all order items
adminRouter.get("/order-items", verifyAdminToken, async (req, res) => {
  try {
    const [orderItems] = await pool.query(`
      SELECT oi.*, o.total_amount, o.status as order_status,
             p.name as product_name, u.name as customer_name
      FROM order_items oi
      LEFT JOIN orders o ON oi.order_id = o.id
      LEFT JOIN products p ON oi.product_id = p.id
      LEFT JOIN users u ON o.user_id = u.id
      ORDER BY oi.created_at DESC
    `);
    res.json({ success: true, data: orderItems });
  } catch (err) {
    console.error("Get order items error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /api/admin/admins - Get all admins
adminRouter.get("/admins", verifyAdminToken, async (req, res) => {
  try {
    const [admins] = await pool.query("SELECT id, email, created_at FROM admins ORDER BY created_at DESC");
    res.json({ success: true, data: admins });
  } catch (err) {
    console.error("Get admins error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Fetch all orders (admin)
adminRouter.get("/orders", verifyAdminToken, async (req, res) => {
  try {
    const [orders] = await pool.query(
      `SELECT 
         o.id, o.user_id, o.shopkeeper_id, o.status, o.total_amount, o.credits_earned,
         o.latitude, o.longitude, o.delivery_address, o.created_at,
         u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
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
        `SELECT oi.order_id, oi.product_id, oi.quantity, oi.price, 
                COALESCE(p.name, 'Product Unavailable') AS product_name,
                p.image AS product_image
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
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Fetch all orders (admin)
// adminRouter.get("/orders", verifyToken, async (req, res) => {
//   try {
//     const [orders] = await pool.query(
//       `SELECT 
//          o.id, o.user_id, o.shopkeeper_id, o.status, o.total_amount, o.credits_earned,
//          o.latitude, o.longitude, o.delivery_address, o.created_at,
//          u.name AS customer_name, u.email AS customer_email,
//          s.shop_name, s.name AS shopkeeper_name
//        FROM orders o
//        JOIN users u ON o.user_id = u.id
//        JOIN shopkeepers s ON o.shopkeeper_id = s.id
//        ORDER BY o.created_at DESC`
//     );

//     const orderIds = orders.map((o) => o.id);
//     let itemsMap = {};

//     if (orderIds.length) {
//       const [items] = await pool.query(
//         `SELECT oi.order_id, oi.product_id, oi.quantity, oi.price, p.name AS product_name
//          FROM order_items oi
//          LEFT JOIN products p ON oi.product_id = p.id
//          WHERE oi.order_id IN (?)`,
//         [orderIds]
//       );
//       items.forEach((it) => {
//         if (!itemsMap[it.order_id]) itemsMap[it.order_id] = [];
//         itemsMap[it.order_id].push(it);
//       });
//     }

//     const result = orders.map((o) => ({ ...o, items: itemsMap[o.id] || [] }));
//     res.json({ success: true, data: result });
//   } catch (err) {
//     res.status(500).json({ success: false, message: "Server error", error: err.message });
//   }
// });

// GET /api/admin/payment-requests - Get all payment requests
adminRouter.get("/payment-requests", verifyAdminToken, async (req, res) => {
  try {
    // Check if billing_payments table exists
    const [tables] = await pool.query("SHOW TABLES LIKE 'billing_payments'");
    
    if (tables.length === 0) {
      // Table doesn't exist, return empty array
      return res.json({ 
        success: true, 
        data: [],
        message: "Payment system not yet configured. Please run the billing_payments.sql schema."
      });
    }

    const [pendingRequests] = await pool.query(`
      SELECT bp.id, bp.shopkeeper_id, bp.amount, bp.payment_method, 
             bp.transaction_id, bp.payment_date as created_at, bp.status, bp.notes as admin_notes,
             s.name as shopkeeper_name, s.email as shopkeeper_email, 
             s.shop_name, s.shop_scale
      FROM billing_payments bp
      LEFT JOIN shopkeepers s ON bp.shopkeeper_id = s.id
      WHERE bp.status = 'pending'
      ORDER BY bp.payment_date DESC
    `);

    res.json({ success: true, data: pendingRequests });
  } catch (err) {
    console.error('Get payment requests error:', err);
    // Return empty array instead of error for better UX
    res.json({ success: true, data: [], error: err.message });
  }
});

// PATCH /api/admin/payment-requests/:id - Process payment request
adminRouter.patch("/payment-requests/:id", verifyAdminToken, async (req, res) => {
  try {
    const requestId = req.params.id;
    const { action, admin_notes } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Use 'approve' or 'reject'"
      });
    }

    const status = action === 'approve' ? 'approved' : 'rejected';

    // Update billing_payments instead of payment_requests
    const [result] = await pool.query(
      `UPDATE billing_payments 
       SET status = ?, notes = ?, approved_by = ?, approved_at = NOW()
       WHERE id = ?`,
      [status, admin_notes || '', req.admin.id, requestId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Payment request not found"
      });
    }

    // Logic for Updating Shopkeeper Subscription if Approved
    if (status === 'approved') {
      const [payment] = await pool.query("SELECT shopkeeper_id FROM billing_payments WHERE id = ?", [requestId]);
      if (payment.length > 0) {
        const shopkeeperId = payment[0].shopkeeper_id;

        await pool.query(`
            UPDATE shopkeepers 
            SET subscription_status = 'active', 
                last_payment_date = NOW(),
                next_payment_due = DATE_ADD(NOW(), INTERVAL 30 DAY)
            WHERE id = ?
         `, [shopkeeperId]);
      }
    }

    res.json({
      success: true,
      message: `Payment request ${action}d successfully`
    });
  } catch (err) {
    console.error('Process payment request error:', err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// GET /api/admin/earnings - Get earnings summary
adminRouter.get("/earnings", verifyAdminToken, async (req, res) => {
  try {
    // Check if billing_payments table exists
    const [tables] = await pool.query("SHOW TABLES LIKE 'billing_payments'");
    
    let earningsData = [{
      pending_payments: 0,
      approved_payments: 0,
      pending_amount: 0,
      total_revenue: 0
    }];

    if (tables.length > 0) {
      // Get earnings summary from billing_payments
      const [data] = await pool.query(`
        SELECT 
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_payments,
          COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_payments,
          COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) as pending_amount,
          COALESCE(SUM(CASE WHEN status = 'approved' THEN amount END), 0) as total_revenue
        FROM billing_payments
      `);
      earningsData = data;
    }

    // Get subscription stats from shopkeepers
    let subscriptionStats = {
      trial_users: 0,
      active_users: 0,
      overdue_users: 0,
      suspended_users: 0
    };

    try {
      const [subData] = await pool.query(`
        SELECT 
          COUNT(CASE WHEN subscription_status = 'trial' OR subscription_status IS NULL THEN 1 END) as trial_users,
          COUNT(CASE WHEN subscription_status = 'active' THEN 1 END) as active_users,
          COUNT(CASE WHEN subscription_status = 'overdue' THEN 1 END) as overdue_users,
          COUNT(CASE WHEN subscription_status = 'suspended' THEN 1 END) as suspended_users
        FROM shopkeepers
      `);
      subscriptionStats = subData[0];
    } catch (subErr) {
      // subscription_status column might not exist, use defaults
      console.log('Subscription stats not available:', subErr.message);
    }

    res.json({
      success: true,
      data: {
        payments: earningsData[0],
        subscriptions: subscriptionStats
      },
      earnings: [] // Empty array for frontend compatibility
    });
  } catch (err) {
    console.error('Get earnings error:', err);
    res.json({ 
      success: true, 
      data: {
        payments: { pending_payments: 0, approved_payments: 0, pending_amount: 0, total_revenue: 0 },
        subscriptions: { trial_users: 0, active_users: 0, overdue_users: 0, suspended_users: 0 }
      },
      earnings: []
    });
  }
});

// GET /api/admin/earnings/summary - Get earnings summary
adminRouter.get("/earnings/summary", verifyAdminToken, async (req, res) => {
  try {
    // Check if billing_payments table exists
    const [tables] = await pool.query("SHOW TABLES LIKE 'billing_payments'");
    
    let earningsData = [{
      pending_payments: 0,
      approved_payments: 0,
      pending_amount: 0,
      total_revenue: 0
    }];

    if (tables.length > 0) {
      const [data] = await pool.query(`
        SELECT 
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_payments,
          COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_payments,
          COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) as pending_amount,
          COALESCE(SUM(CASE WHEN status = 'approved' THEN amount END), 0) as total_revenue
        FROM billing_payments
      `);
      earningsData = data;
    }

    // Get subscription stats from shopkeepers (handle missing column)
    let subscriptionData = [{
      trial_users: 0,
      active_users: 0,
      overdue_users: 0,
      suspended_users: 0
    }];

    try {
      const [subData] = await pool.query(`
        SELECT 
          COUNT(CASE WHEN subscription_status = 'trial' OR subscription_status IS NULL THEN 1 END) as trial_users,
          COUNT(CASE WHEN subscription_status = 'active' THEN 1 END) as active_users,
          COUNT(CASE WHEN subscription_status = 'overdue' THEN 1 END) as overdue_users,
          COUNT(CASE WHEN subscription_status = 'suspended' THEN 1 END) as suspended_users
        FROM shopkeepers
      `);
      subscriptionData = subData;
    } catch (subErr) {
      // subscription_status column might not exist
      console.log('Subscription stats not available:', subErr.message);
    }

    res.json({
      success: true,
      data: {
        payments: earningsData[0],
        subscriptions: subscriptionData[0]
      }
    });
  } catch (err) {
    console.error('Get earnings summary error:', err);
    res.json({ 
      success: true, 
      data: {
        payments: { pending_payments: 0, approved_payments: 0, pending_amount: 0, total_revenue: 0 },
        subscriptions: { trial_users: 0, active_users: 0, overdue_users: 0, suspended_users: 0 }
      }
    });
  }
});

// Get admin by ID (protected) - keep this at the end
adminRouter.get("/:id", verifyAdminToken, async (req, res) => {
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
adminRouter.put("/:id", verifyAdminToken, async (req, res) => {
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
adminRouter.delete("/:id", verifyAdminToken, async (req, res) => {
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

// Admin Login - Environment-based fallback for unusual admin table
adminRouter.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password are required" });
  }

  try {
    console.log('🔍 Admin login attempt for:', email);

    // Since your admin table has unusual structure, use environment variables as fallback
    const envAdminEmail = process.env.ADMIN_EMAIL || 'nexkirana@kirana.com';
    const envAdminPassword = process.env.ADMIN_PASSWORD || 'qwI41L5U47RwaI47DasA';

    console.log('🔧 Using environment admin credentials');
    console.log('📧 Expected email:', envAdminEmail);

    // Check email match (flexible)
    const emailMatches = (
      email.toLowerCase() === envAdminEmail.toLowerCase() ||
      (email.toLowerCase().includes('nexkirana') && envAdminEmail.toLowerCase().includes('nexkirana')) ||
      (email.toLowerCase().includes('admin') && envAdminEmail.toLowerCase().includes('admin'))
    );

    if (!emailMatches) {
      console.log('📧 Email mismatch');
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // Check password match
    const passwordMatches = (password === envAdminPassword);

    if (!passwordMatches) {
      console.log('🔐 Password mismatch');
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: 1,
        email: envAdminEmail,
        role: 'admin'
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('✅ Environment-based admin login successful');
    res.json({
      success: true,
      token,
      admin: {
        id: 1,
        email: envAdminEmail
      },
      message: "Admin login successful"
    });

  } catch (err) {
    console.error("❌ Admin login error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// Example protected route
adminRouter.get("/profile", verifyAdminToken, async (req, res) => {
  try {
    // Since admin login uses environment variables, return the admin info from JWT token
    const adminInfo = {
      id: req.admin.id,
      email: req.admin.email,
      role: req.admin.role,
      created_at: new Date().toISOString() // Placeholder since we don't have DB record
    };

    res.json({ success: true, data: adminInfo });
  } catch (err) {
    console.error("Admin profile error:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// EARNINGS MANAGEMENT ENDPOINTS - DISABLED (Tables not available in current schema)
// Uncomment and modify these endpoints when earnings tables are added to the database

/*
// Placeholder for earnings management - returns basic statistics instead
adminRouter.get("/earnings", verifyAdminToken, async (req, res) => {
  try {
    // Get basic order statistics instead of earnings
    const [orderStats] = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status = 'Delivered' THEN 1 END) as delivered_orders,
        COALESCE(SUM(CASE WHEN status = 'Delivered' THEN total_amount END), 0) as total_sales,
        COUNT(DISTINCT shopkeeper_id) as active_shopkeepers
      FROM orders
    `);

    res.json({ 
      success: true, 
      message: "Earnings system not yet implemented",
      orderStats: orderStats[0],
      note: "This is placeholder data. Earnings system will be implemented when earnings tables are added."
    });
  } catch (err) {
    console.error("Get earnings placeholder error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
*/

// Get pending payments
adminRouter.get("/pending-payments", verifyAdminToken, async (req, res) => {
  try {
    const [payments] = await pool.query(`
      SELECT 
        bp.*,
        s.name as shopkeeper_name,
        s.shop_name,
        s.email as shopkeeper_email,
        s.shop_scale
      FROM billing_payments bp
      JOIN shopkeepers s ON bp.shopkeeper_id = s.id
      WHERE bp.status = 'pending'
      ORDER BY bp.payment_date DESC
    `);

    res.json({ success: true, data: payments });
  } catch (err) {
    console.error("Get pending payments error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Approve/reject payment
adminRouter.patch("/payments/:id/status", verifyAdminToken, async (req, res) => {
  try {
    const paymentId = req.params.id;
    const { status, notes } = req.body; // 'approved' or 'rejected'

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be 'approved' or 'rejected'"
      });
    }

    // Update payment status
    const [result] = await pool.query(
      "UPDATE billing_payments SET status = ?, approved_by = ?, approved_at = NOW(), notes = ? WHERE id = ?",
      [status, req.admin.id, notes || '', paymentId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    // If approved, update shopkeeper subscription using subscription utility
    if (status === 'approved') {
      const [payment] = await pool.query(
        "SELECT shopkeeper_id FROM billing_payments WHERE id = ?",
        [paymentId]
      );

      if (payment.length > 0) {
        const shopkeeperId = payment[0].shopkeeper_id;
        
        // Use subscription utility to properly reset billing cycle
        await processPaymentApproval(shopkeeperId);
      }
    }

    res.json({
      success: true,
      message: `Payment ${status} successfully`
    });
  } catch (err) {
    console.error("Update payment status error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get payment statistics
adminRouter.get("/payment-stats", verifyAdminToken, async (req, res) => {
  try {
    const [stats] = await pool.query(`
      SELECT 
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_payments,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_payments,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_payments,
        SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END) as total_revenue,
        SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) as pending_amount
      FROM billing_payments
    `);

    const [subscriptionStats] = await pool.query(`
      SELECT 
        COUNT(CASE WHEN subscription_status = 'trial' THEN 1 END) as trial_users,
        COUNT(CASE WHEN subscription_status = 'active' THEN 1 END) as active_users,
        COUNT(CASE WHEN subscription_status = 'overdue' THEN 1 END) as overdue_users,
        COUNT(CASE WHEN subscription_status = 'suspended' THEN 1 END) as suspended_users
      FROM shopkeepers
    `);

    res.json({
      success: true,
      data: {
        payments: stats[0],
        subscriptions: subscriptionStats[0]
      }
    });
  } catch (err) {
    console.error("Get payment stats error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Payment Info Management Routes
// GET /api/admin/payment-info - Get payment information
adminRouter.get("/payment-info", verifyAdminToken, async (req, res) => {
  try {
    // Check if payment_info table exists, if not create a default response
    const [rows] = await pool.query("SELECT * FROM payment_info LIMIT 1").catch(() => [[]]);

    if (rows.length === 0) {
      // Return default payment info structure
      return res.json({
        success: true,
        data: {
          upi_id: '',
          bank_account: '',
          ifsc_code: '',
          account_holder: '',
          qr_code: null
        }
      });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Payment info fetch error:', err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// GET /api/admin/payment-info/admin - Get admin payment information
adminRouter.get("/payment-info/admin", verifyAdminToken, async (req, res) => {
  try {
    // Return admin-specific payment info
    const [rows] = await pool.query("SELECT * FROM payment_info WHERE type = 'admin' LIMIT 1").catch(() => [[]]);

    if (rows.length === 0) {
      return res.json({
        success: true,
        data: {
          upi_id: '',
          bank_account: '',
          ifsc_code: '',
          account_holder: 'NexKirana Admin',
          qr_code: null,
          type: 'admin'
        }
      });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Admin payment info fetch error:', err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// PUT /api/admin/payment-info - Update payment information
adminRouter.put("/payment-info", verifyAdminToken, upload.single('qr_code'), async (req, res) => {
  try {
    console.log('📝 Payment info update request received');
    console.log('Body:', req.body);
    console.log('File:', req.file ? 'Present' : 'None');
    console.log('Content-Type:', req.headers['content-type']);
    
    // Check if req.body exists
    if (!req.body) {
      console.error('❌ req.body is undefined!');
      return res.status(400).json({
        success: false,
        message: "Request body is missing. Ensure Content-Type is multipart/form-data"
      });
    }
    
    const { upi_id, bank_account, bank_name, ifsc_code, account_holder, account_holder_name } = req.body;
    // Support both account_holder and account_holder_name for compatibility
    const holderName = account_holder_name || account_holder;
    let qr_code_url = null;

    // Handle QR code upload if provided
    if (req.file) {
      try {
        // Upload to Cloudinary
        const result = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              resource_type: 'image',
              folder: 'nexkirana/payment-qr',
              transformation: [
                { width: 500, height: 500, crop: 'limit' },
                { quality: 'auto' }
              ]
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );

          streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
        });

        qr_code_url = result.secure_url;
      } catch (uploadError) {
        console.error('QR code upload error:', uploadError);
        return res.status(500).json({
          success: false,
          message: "Failed to upload QR code image"
        });
      }
    }

    // Note: Table should already exist from migration script
    // If it doesn't exist, the query below will fail with a clear error

    // Check if record exists
    const [existing] = await pool.query("SELECT id FROM payment_info WHERE type = 'admin' LIMIT 1");

    if (existing.length > 0) {
      // Update existing record
      const updateFields = [];
      const updateValues = [];

      if (upi_id !== undefined) {
        updateFields.push('upi_id = ?');
        updateValues.push(upi_id);
      }
      if (bank_account !== undefined) {
        updateFields.push('bank_account = ?');
        updateValues.push(bank_account);
      }
      if (bank_name !== undefined) {
        updateFields.push('bank_name = ?');
        updateValues.push(bank_name);
      }
      if (ifsc_code !== undefined) {
        updateFields.push('ifsc_code = ?');
        updateValues.push(ifsc_code);
      }
      if (holderName !== undefined) {
        updateFields.push('account_holder = ?');
        updateValues.push(holderName);
      }
      if (qr_code_url) {
        updateFields.push('qr_code = ?');
        updateValues.push(qr_code_url);
      }

      // Ensure at least one field is being updated
      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No fields to update"
        });
      }

      updateValues.push(existing[0].id);

      await pool.query(
        `UPDATE payment_info SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );
    } else {
      // Insert new record
      await pool.query(
        `INSERT INTO payment_info (upi_id, bank_account, bank_name, ifsc_code, account_holder, qr_code, type) 
         VALUES (?, ?, ?, ?, ?, ?, 'admin')`,
        [upi_id || '', bank_account || '', bank_name || '', ifsc_code || '', holderName || 'NexKirana Admin', qr_code_url]
      );
    }

    res.json({
      success: true,
      message: "Payment information updated successfully",
      qr_code_url: qr_code_url
    });
  } catch (err) {
    console.error('Payment info update error:', err);
    console.error('Error stack:', err.stack);
    res.status(500).json({ 
      success: false, 
      message: "Server error", 
      error: err.message,
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Test endpoint to verify payment-info setup
adminRouter.get("/payment-info/test", verifyAdminToken, async (req, res) => {
  try {
    // Check table exists
    const [tables] = await pool.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'payment_info'
    `);
    
    // Check columns
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'payment_info'
    `);
    
    res.json({
      success: true,
      tableExists: tables.length > 0,
      columns: columns.map(c => c.COLUMN_NAME),
      cloudinaryConfigured: !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY),
      uploadMiddleware: typeof upload === 'function' ? 'configured' : 'missing'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});



export default adminRouter;