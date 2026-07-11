import express from "express";
import bcrypt from "bcryptjs";
import verifyAdminToken from "../middleware/adminAuth.js";

import pool from "../config/db.js";
import upload from "../config/upload.js";
import cloudinary from "../config/cloudinary.js";
import streamifier from "streamifier";
import { processPaymentApproval } from "../utils/subscription.js";
import { createJWEToken } from "../utils/jweToken.js";

const adminRouter = express.Router();

// Fetch all shopkeepers (protected) with optional status filtering
adminRouter.get("/shopkeepers", verifyAdminToken, async (req, res) => {
  try {
    const { status } = req.query; // Get status filter from query params

    let whereClause = "WHERE (is_deleted = 0 OR is_deleted IS NULL)"; // Exclude soft-deleted shopkeepers, include NULL
    let queryParams = [];

    // Add status filtering based on query parameter
    if (status && status !== "all") {
      if (status === "pending") {
        whereClause += " AND (is_verified IS NULL OR is_verified = '')";
      } else if (status === "approved") {
        whereClause += " AND is_verified = ?";
        queryParams.push(1);
      } else if (status === "rejected") {
        whereClause += " AND is_verified = ?";
        queryParams.push(0);
      }
    }

    const query = `SELECT id, name, email, phone, address, shop_name, img, is_verified, shop_scale, created_at, subscription_status, next_payment_due, last_payment_date FROM shopkeepers ${whereClause} ORDER BY created_at DESC`;

    const [rows] = await pool.execute(query, queryParams);

    // Map is_verified to verification_status for frontend compatibility and ensure valid IDs
    const mappedRows = rows
      .filter((row) => row.id != null && row.id !== 0) // Filter out any invalid IDs
      .map((row) => ({
        ...row,
        id: parseInt(row.id), // Ensure ID is a number
        verification_status:
          row.is_verified === 1
            ? "approved"
            : row.is_verified === 0
              ? "rejected"
              : "pending",
      }));

    // Add summary statistics for the admin panel (excluding deleted)
    const [stats] = await pool.execute(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN is_verified = 1 THEN 1 END) as approved,
        COUNT(CASE WHEN is_verified = 0 THEN 1 END) as rejected,
        COUNT(CASE WHEN is_verified IS NULL OR is_verified = '' THEN 1 END) as pending
      FROM shopkeepers 
      WHERE id IS NOT NULL AND (is_deleted = 0 OR is_deleted IS NULL)
    `);

    res.json({
      success: true,
      data: mappedRows,
      stats: stats[0],
      filter: status || "all",
    });
  } catch (err) {
    console.error("Get shopkeepers error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
});

// Get shopkeeper statistics for admin panel tabs
adminRouter.get("/shopkeepers/stats", verifyAdminToken, async (req, res) => {
  try {
    const [stats] = await pool.execute(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN is_verified = 1 THEN 1 END) as approved,
        COUNT(CASE WHEN is_verified = 0 THEN 1 END) as rejected,
        COUNT(CASE WHEN is_verified IS NULL OR is_verified = '' THEN 1 END) as pending
      FROM shopkeepers 
      WHERE id IS NOT NULL AND (is_deleted = 0 OR is_deleted IS NULL)
    `);

    const [recentActivity] = await pool.execute(`
      SELECT 
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as new_this_week,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as new_this_month
      FROM shopkeepers 
      WHERE id IS NOT NULL AND (is_deleted = 0 OR is_deleted IS NULL)
    `);

    res.json({
      success: true,
      data: {
        ...stats[0],
        ...recentActivity[0],
      },
    });
  } catch (err) {
    console.error("Get shopkeeper stats error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
});

// Fetch all customers/users (protected)
adminRouter.get("/customers", verifyAdminToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, name, email, phone, address, created_at FROM users ORDER BY created_at DESC"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
});

// Delete customer (protected)
adminRouter.delete(
  "/customers/:customerId",
  verifyAdminToken,
  async (req, res) => {
    try {
      const customerId = parseInt(req.params.customerId);

      if (isNaN(customerId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid customer ID" });
      }

      // Check if customer exists
      const [customer] = await pool.execute(
        "SELECT id, name, email FROM users WHERE id = ?",
        [customerId]
      );

      if (customer.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Customer not found" });
      }

      // Delete customer (soft delete or hard delete based on your preference)
      // Using hard delete here - change to soft delete if needed
      const [result] = await pool.execute("DELETE FROM users WHERE id = ?", [
        customerId,
      ]);

      if (result.affectedRows === 0) {
        return res
          .status(500)
          .json({ success: false, message: "Failed to delete customer" });
      }

      console.log(
        `Customer ${customerId} (${customer[0].name}) deleted successfully`
      );

      res.json({
        success: true,
        message: `Customer "${customer[0].name}" deleted successfully`,
        deletedCustomer: {
          id: customer[0].id,
          name: customer[0].name,
          email: customer[0].email,
        },
      });
    } catch (err) {
      console.error("Delete customer error:", err);
      res
        .status(500)
        .json({ success: false, message: "Server error", error: err.message });
    }
  }
);

// Test endpoint to debug verification issues
adminRouter.get("/test-verify/:id", verifyAdminToken, async (req, res) => {
  try {
    const shopkeeperId = req.params.id;
    console.log(`Testing verification for shopkeeper ${shopkeeperId}`);

    // Check if shopkeeper exists
    const [shopkeeper] = await pool.execute(
      "SELECT id, name, email, is_verified FROM shopkeepers WHERE id = ?",
      [shopkeeperId]
    );

    if (shopkeeper.length === 0) {
      return res.json({
        success: false,
        message: "Shopkeeper not found",
        shopkeeperId,
        found: false,
      });
    }

    res.json({
      success: true,
      message: "Shopkeeper found",
      shopkeeper: shopkeeper[0],
      found: true,
    });
  } catch (error) {
    console.error("Test verify error:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
});

// Verify/Reject shopkeeper (protected)
adminRouter.patch(
  "/shopkeepers/:id/verify",
  verifyAdminToken,
  async (req, res) => {
    try {
      const shopkeeperId = req.params.id;
      const { action } = req.body; // "approve" or "reject"

      // Validate shopkeeper ID
      if (
        !shopkeeperId ||
        shopkeeperId === "null" ||
        shopkeeperId === "undefined" ||
        isNaN(parseInt(shopkeeperId))
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid shopkeeper ID. Please refresh the page and try again.",
        });
      }

      console.log(
        `Verification request: shopkeeper ${shopkeeperId}, action: ${action}`
      );

      if (!["approve", "reject"].includes(action)) {
        return res.status(400).json({
          success: false,
          message: "Invalid action. Use 'approve' or 'reject'",
        });
      }

      const is_verified = action === "approve" ? 1 : 0;

      // First check if shopkeeper exists
      const [existingShopkeeper] = await pool.execute(
        "SELECT id, name, email FROM shopkeepers WHERE id = ?",
        [shopkeeperId]
      );

      if (existingShopkeeper.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Shopkeeper not found" });
      }

      // Update verification status using is_verified column
      // Set subscription_status to active and initialize billing from day 1 when approving
      // 17-day total cycle: 15 days billing + 2 days grace period
      let updateQuery, updateParams;
      if (action === "approve") {
        const now = new Date();
        const nextPaymentDue = new Date(now);
        nextPaymentDue.setDate(nextPaymentDue.getDate() + 15); // 15 days billing period

        const gracePeriodEnd = new Date(nextPaymentDue);
        gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 2); // 2 days grace period

        updateQuery = `UPDATE shopkeepers 
                     SET is_verified = ?, 
                         subscription_status = 'active',
                         last_payment_date = NOW(),
                         next_payment_due = ?,
                         grace_period_end = ?
                     WHERE id = ?`;
        updateParams = [
          is_verified,
          nextPaymentDue,
          gracePeriodEnd,
          parseInt(shopkeeperId),
        ];
      } else {
        updateQuery = "UPDATE shopkeepers SET is_verified = ? WHERE id = ?";
        updateParams = [is_verified, parseInt(shopkeeperId)];
      }

      const [result] = await pool.execute(updateQuery, updateParams);

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Failed to update shopkeeper status",
        });
      }

      console.log(
        `✅ Updated shopkeeper ${shopkeeperId} verification status to: ${is_verified}`
      );

      // Get updated shopkeeper details for response
      const [shopkeeper] = await pool.execute(
        "SELECT * FROM shopkeepers WHERE id = ?",
        [shopkeeperId]
      );

      console.log(`Verification successful: ${JSON.stringify(shopkeeper[0])}`);

      res.json({
        success: true,
        message: `Shopkeeper ${action}d successfully`,
        shopkeeper: shopkeeper[0],
      });
    } catch (err) {
      console.error("Shopkeeper verification error:", err);
      res
        .status(500)
        .json({ success: false, message: "Server error", error: err.message });
    }
  }
);

// Simple verification endpoint as fallback
adminRouter.post(
  "/shopkeepers/:id/status",
  verifyAdminToken,
  async (req, res) => {
    try {
      const shopkeeperId = req.params.id;
      const { status } = req.body; // "approved", "rejected", or "pending"

      // Validate shopkeeper ID
      if (
        !shopkeeperId ||
        shopkeeperId === "null" ||
        shopkeeperId === "undefined" ||
        isNaN(parseInt(shopkeeperId))
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid shopkeeper ID. Please refresh the page and try again.",
        });
      }

      console.log(
        `Simple verification: shopkeeper ${shopkeeperId}, status: ${status}`
      );

      // Map status to is_verified value
      let is_verified;
      if (
        status === "approved" ||
        status === "verified" ||
        status === "1" ||
        status === 1
      ) {
        is_verified = 1;
      } else if (status === "rejected" || status === "0" || status === 0) {
        is_verified = 0;
      } else {
        is_verified = null; // pending
      }

      // Check if shopkeeper exists first
      const [existingShopkeeper] = await pool.execute(
        "SELECT id, name FROM shopkeepers WHERE id = ?",
        [parseInt(shopkeeperId)]
      );

      if (existingShopkeeper.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Shopkeeper not found" });
      }

      // Update verification status
      // Set subscription_status to active and initialize billing from day 1 when approving
      // 17-day total cycle: 15 days billing + 2 days grace period
      let updateQuery, updateParams;
      if (is_verified === 1) {
        const now = new Date();
        const nextPaymentDue = new Date(now);
        nextPaymentDue.setDate(nextPaymentDue.getDate() + 15); // 15 days billing period

        const gracePeriodEnd = new Date(nextPaymentDue);
        gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 2); // 2 days grace period

        updateQuery = `UPDATE shopkeepers 
                     SET is_verified = ?, 
                         subscription_status = 'active',
                         last_payment_date = NOW(),
                         next_payment_due = ?,
                         grace_period_end = ?
                     WHERE id = ?`;
        updateParams = [
          is_verified,
          nextPaymentDue,
          gracePeriodEnd,
          parseInt(shopkeeperId),
        ];
      } else {
        updateQuery = "UPDATE shopkeepers SET is_verified = ? WHERE id = ?";
        updateParams = [is_verified, parseInt(shopkeeperId)];
      }

      await pool.execute(updateQuery, updateParams);

      const statusText =
        is_verified === 1
          ? "approved"
          : is_verified === 0
            ? "rejected"
            : "pending";

      res.json({
        success: true,
        message: `Shopkeeper ${statusText} successfully`,
        shopkeeperId: parseInt(shopkeeperId),
        is_verified,
        verification_status: statusText,
      });
    } catch (err) {
      console.error("Shopkeeper verification error:", err);
      res
        .status(500)
        .json({ success: false, message: "Server error", error: err.message });
    }
  }
);

// Admin Registration (only for initial setup)
adminRouter.post("/register", async (req, res) => {
  try {
    // Check if any admin already exists
    const [existingAdmins] = await pool.execute(
      "SELECT COUNT(*) as count FROM admins"
    );
    if (existingAdmins[0].count > 0) {
      return res.status(403).json({
        success: false,
        message: "Admin registration is disabled. Admin already exists.",
      });
    }

    // Use environment variables for admin credentials
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
      return res.status(500).json({
        success: false,
        message: "Admin credentials not configured",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      "INSERT INTO admins (email, password) VALUES (?, ?)",
      [email, hashedPassword]
    );

    res.status(201).json({
      success: true,
      data: { id: result.insertId, email },
      message: "Initial admin created successfully",
    });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
});

// List all admins (protected)
adminRouter.get("/", verifyAdminToken, async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT id, email, created_at FROM admins");
    res.json({ success: true, data: rows });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
});

adminRouter.get("/dashboard", verifyAdminToken, async (req, res) => {
  try {
    // Shopkeepers count
    const [shopkeepers] = await pool.execute(
      "SELECT COUNT(*) as count FROM shopkeepers"
    );
    // Customers count
    const [customers] = await pool.execute("SELECT COUNT(*) as count FROM users");
    // Orders count and revenue
    const [ordersRows] = await pool.execute(
      "SELECT COUNT(*) as count, COALESCE(SUM(total_amount),0) as revenue FROM orders"
    );
    const orders = ordersRows[0].count;
    const revenue = ordersRows[0].revenue;
    // Top products (by sales)
    const [topProducts] = await pool.execute(
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
});

// adminRouter.get("/products", verifyToken, async (req, res) => {
//   try {
//     const [rows] = await pool.execute(
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
//       const [dbResult] = await pool.execute(
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
//       const [dbResult] = await pool.execute(
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
//     const [result] = await pool.execute("DELETE FROM products WHERE id=?", [
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
    const [rows] = await pool.execute(
      "SELECT id, name, price, category, description, image, brand, barcode, shop_scales, created_at FROM global_products ORDER BY created_at DESC"
    );

    // Parse shop_scales JSON for each product - handle both JSON arrays and plain strings
    const products = rows.map((product) => {
      let shopScales = ["all"];
      if (product.shop_scales) {
        try {
          const parsed = JSON.parse(product.shop_scales);
          // Handle both array and plain string formats
          shopScales = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          // Fallback: treat plain string as single-item array
          shopScales = [product.shop_scales];
        }
      }
      return {
        ...product,
        shopScales: shopScales,
      };
    });

    res.json({ success: true, data: products });
  } catch (err) {
    console.error("Get global products error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
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
      shopScales,
      imageUrl: providedImageUrl, // Image URL from OpenFoodFacts or other sources
    } = req.body;

    if (!name || !price) {
      return res.status(400).json({
        success: false,
        message: "Name and price are required",
      });
    }

    // Check for duplicate barcode if provided
    if (barcode) {
      try {
        const [existingProducts] = await pool.execute(
          "SELECT id, name FROM global_products WHERE barcode = ?",
          [barcode]
        );

        if (existingProducts.length > 0) {
          return res.status(409).json({
            success: false,
            message: `Product with barcode ${barcode} already exists: "${existingProducts[0].name}"`,
            existingProduct: existingProducts[0],
          });
        }
      } catch (checkErr) {
        console.error("Error checking duplicate barcode:", checkErr);
        // Continue with creation if check fails
      }
    }

    let imageUrl = null;
    try {
      // Priority: uploaded file > provided URL
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
      } else if (providedImageUrl) {
        // Use the provided image URL (e.g., from OpenFoodFacts)
        imageUrl = providedImageUrl;
      }

      // Parse shopScales if it's a string, otherwise use as-is
      let parsedShopScales = ["all"]; // default
      if (shopScales) {
        try {
          parsedShopScales =
            typeof shopScales === "string"
              ? JSON.parse(shopScales)
              : shopScales;
        } catch (e) {
          console.warn("Failed to parse shopScales, using default:", e);
        }
      }

      // Use database transaction for thread-safe ID generation
      await pool.execute("START TRANSACTION");

      try {
        // Lock the table and get next ID
        const [maxIdResult] = await pool.execute(
          "SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM global_products FOR UPDATE"
        );
        const nextId = maxIdResult[0].next_id;

        // ✅ FIX: Ensure price is stored with exactly 2 decimal places
        const formattedPrice = parseFloat(parseFloat(price).toFixed(2));

        const [dbResult] = await pool.execute(
          "INSERT INTO global_products (id, name, price, category, description, image, brand, barcode, shop_scales) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            nextId,
            name,
            formattedPrice,
            category || null,
            description || "",
            imageUrl,
            brand || null,
            barcode || null,
            JSON.stringify(parsedShopScales),
          ]
        );

        await pool.execute("COMMIT");

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
        await pool.execute("ROLLBACK");
        throw transactionError;
      }
    } catch (err) {
      console.error("Create global product error:", err);
      res
        .status(500)
        .json({ success: false, message: "Server error", error: err.message });
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
    if (!productId || productId === "null" || productId === "undefined") {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID. Product ID is required for update.",
      });
    }

    const {
      name,
      price,
      category,
      description,
      brand,
      barcode,
      shopScales,
      imageUrl: providedImageUrl, // Image URL from OpenFoodFacts or other sources
    } = req.body;
    let imageUrl = req.body.image || null;

    try {
      // Priority: uploaded file > provided URL > existing image
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
      } else if (providedImageUrl) {
        // Use the provided image URL (e.g., from OpenFoodFacts)
        imageUrl = providedImageUrl;
      }

      // Parse shopScales if it's a string, otherwise use as-is
      let parsedShopScales = ["all"]; // default
      if (shopScales) {
        try {
          parsedShopScales =
            typeof shopScales === "string"
              ? JSON.parse(shopScales)
              : shopScales;
        } catch (e) {
          console.warn("Failed to parse shopScales, using default:", e);
        }
      }

      // ✅ FIX: Ensure price is stored with exactly 2 decimal places
      const formattedPrice = parseFloat(parseFloat(price).toFixed(2));

      const [dbResult] = await pool.execute(
        "UPDATE global_products SET name=?, price=?, category=?, description=?, image=?, brand=?, barcode=?, shop_scales=? WHERE id=?",
        [
          name,
          formattedPrice,
          category || null,
          description || "",
          imageUrl,
          brand || null,
          barcode || null,
          JSON.stringify(parsedShopScales),
          parseInt(productId),
        ]
      );

      if (dbResult.affectedRows === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Global product not found" });
      }

      res.json({ success: true, message: "Global product updated" });
    } catch (err) {
      console.error("Update global product error:", err);
      res
        .status(500)
        .json({ success: false, message: "Server error", error: err.message });
    }
  }
);

// Delete a global product (admin)
adminRouter.delete(
  "/global-products/:id",
  verifyAdminToken,
  async (req, res) => {
    const productId = req.params.id;

    // Validate product ID
    if (!productId || productId === "null" || productId === "undefined") {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID. Product ID is required for deletion.",
      });
    }

    try {
      const [result] = await pool.execute(
        "DELETE FROM global_products WHERE id = ?",
        [parseInt(productId)]
      );
      if (result.affectedRows === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Global product not found" });
      }
      res.json({ success: true, message: "Global product deleted" });
    } catch (err) {
      console.error("Delete global product error:", err);
      res
        .status(500)
        .json({ success: false, message: "Server error", error: err.message });
    }
  }
);

// Delete a shopkeeper (admin)
adminRouter.delete("/shopkeepers/:id", verifyAdminToken, async (req, res) => {
  const shopkeeperId = req.params.id;

  // Validate shopkeeper ID
  if (
    !shopkeeperId ||
    shopkeeperId === "null" ||
    shopkeeperId === "undefined" ||
    isNaN(parseInt(shopkeeperId))
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid shopkeeper ID. Shopkeeper ID is required for deletion.",
    });
  }

  try {
    // Check if shopkeeper exists
    const [existingShopkeeper] = await pool.execute(
      "SELECT id, name, email, shop_name FROM shopkeepers WHERE id = ?",
      [parseInt(shopkeeperId)]
    );

    if (existingShopkeeper.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Shopkeeper not found" });
    }

    const shopkeeper = existingShopkeeper[0];

    // Check if shopkeeper has active orders
    const [activeOrders] = await pool.execute(
      "SELECT COUNT(*) as count FROM orders WHERE shopkeeper_id = ? AND status IN ('Pending', 'Preparing', 'Ready')",
      [parseInt(shopkeeperId)]
    );

    if (activeOrders[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete shopkeeper. There are ${activeOrders[0].count} active order(s) associated with this shopkeeper. Please complete or cancel them first.`,
      });
    }

    // Delete shopkeeper (cascade will handle related records based on DB constraints)
    const [result] = await pool.execute("DELETE FROM shopkeepers WHERE id = ?", [
      parseInt(shopkeeperId),
    ]);

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Failed to delete shopkeeper" });
    }

    console.log(
      `✅ Deleted shopkeeper ${shopkeeperId} (${shopkeeper.name} - ${shopkeeper.shop_name})`
    );

    res.json({
      success: true,
      message: `Shopkeeper "${shopkeeper.name}" deleted successfully`,
      deletedShopkeeper: {
        id: shopkeeper.id,
        name: shopkeeper.name,
        email: shopkeeper.email,
        shop_name: shopkeeper.shop_name,
      },
    });
  } catch (err) {
    console.error("Delete shopkeeper error:", err);

    // Handle foreign key constraint errors
    if (err.code === "ER_ROW_IS_REFERENCED_2") {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete shopkeeper. There are related records (orders, products, etc.) associated with this shopkeeper.",
      });
    }

    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
});

// ============================================================================
// SUSPEND SHOPKEEPER
// ============================================================================
// PATCH /api/admin/shopkeepers/:id/suspend - Suspend a shopkeeper
adminRouter.patch(
  "/shopkeepers/:id/suspend",
  verifyAdminToken,
  async (req, res) => {
    const shopkeeperId = req.params.id;
    const { reason } = req.body; // Optional suspension reason

    // Validate shopkeeper ID
    if (
      !shopkeeperId ||
      shopkeeperId === "null" ||
      shopkeeperId === "undefined" ||
      isNaN(parseInt(shopkeeperId))
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid shopkeeper ID",
      });
    }

    try {
      // Check if shopkeeper exists
      const [existingShopkeeper] = await pool.execute(
        "SELECT id, name, email, shop_name, subscription_status FROM shopkeepers WHERE id = ?",
        [parseInt(shopkeeperId)]
      );

      if (existingShopkeeper.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Shopkeeper not found",
        });
      }

      const shopkeeper = existingShopkeeper[0];

      // Check if already suspended
      if (shopkeeper.subscription_status === "suspended") {
        return res.status(400).json({
          success: false,
          message: `Shopkeeper "${shopkeeper.name}" is already suspended`,
        });
      }

      // Suspend the shopkeeper
      const [result] = await pool.execute(
        "UPDATE shopkeepers SET subscription_status = 'suspended' WHERE id = ?",
        [parseInt(shopkeeperId)]
      );

      if (result.affectedRows === 0) {
        return res.status(500).json({
          success: false,
          message: "Failed to suspend shopkeeper",
        });
      }

      console.log(
        `🚫 Suspended shopkeeper ${shopkeeperId} (${shopkeeper.name} - ${shopkeeper.shop_name})${reason ? ` - Reason: ${reason}` : ""}`
      );

      res.json({
        success: true,
        message: `Shopkeeper "${shopkeeper.name}" suspended successfully`,
        shopkeeper: {
          id: shopkeeper.id,
          name: shopkeeper.name,
          email: shopkeeper.email,
          shop_name: shopkeeper.shop_name,
          subscription_status: "suspended",
          suspension_reason: reason || null,
        },
      });
    } catch (err) {
      console.error("Suspend shopkeeper error:", err);
      res.status(500).json({
        success: false,
        message: "Server error",
        error: err.message,
      });
    }
  }
);

// ============================================================================
// UNSUSPEND SHOPKEEPER
// ============================================================================
// PATCH /api/admin/shopkeepers/:id/unsuspend - Unsuspend a shopkeeper
adminRouter.patch(
  "/shopkeepers/:id/unsuspend",
  verifyAdminToken,
  async (req, res) => {
    const shopkeeperId = req.params.id;

    // Validate shopkeeper ID
    if (
      !shopkeeperId ||
      shopkeeperId === "null" ||
      shopkeeperId === "undefined" ||
      isNaN(parseInt(shopkeeperId))
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid shopkeeper ID",
      });
    }

    try {
      // Check if shopkeeper exists
      const [existingShopkeeper] = await pool.execute(
        "SELECT id, name, email, shop_name, subscription_status FROM shopkeepers WHERE id = ?",
        [parseInt(shopkeeperId)]
      );

      if (existingShopkeeper.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Shopkeeper not found",
        });
      }

      const shopkeeper = existingShopkeeper[0];

      // Check if not suspended or in grace period
      if (
        shopkeeper.subscription_status !== "suspended" &&
        shopkeeper.subscription_status !== "grace_period"
      ) {
        return res.status(400).json({
          success: false,
          message: `Shopkeeper "${shopkeeper.name}" is not suspended or in grace period (current status: ${shopkeeper.subscription_status || "active"})`,
        });
      }

      // Reset billing cycle when unsuspending (payment assumed to be made)
      const now = new Date();
      const nextPaymentDue = new Date(now);
      nextPaymentDue.setDate(nextPaymentDue.getDate() + 15); // 15 days billing period

      const gracePeriodEnd = new Date(nextPaymentDue);
      gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 2); // 2 days grace period

      // Mark pending payments as approved (keep audit trail, like payment approval)
      // New cycle starts with zero payable amount
      await pool.execute(
        `UPDATE billing_payments 
         SET status = 'approved',
             approved_at = NOW(),
             approved_by = ?
         WHERE shopkeeper_id = ? AND status = 'pending'`,
        [req.admin.id, parseInt(shopkeeperId)]
      );

      // Unsuspend the shopkeeper and reset billing cycle
      const [result] = await pool.execute(
        `UPDATE shopkeepers 
       SET subscription_status = 'active',
           last_payment_date = ?,
           next_payment_due = ?,
           grace_period_end = ?
       WHERE id = ?`,
        [now, nextPaymentDue, gracePeriodEnd, parseInt(shopkeeperId)]
      );

      if (result.affectedRows === 0) {
        return res.status(500).json({
          success: false,
          message: "Failed to unsuspend shopkeeper",
        });
      }

      console.log(
        `✅ Unsuspended shopkeeper ${shopkeeperId} (${shopkeeper.name} - ${shopkeeper.shop_name}) - Billing cycle reset, pending payments approved, new cycle starts with zero`
      );

      res.json({
        success: true,
        message: `Shopkeeper "${shopkeeper.name}" unsuspended successfully. Pending payments approved. New billing cycle starts with zero payable amount.`,
        shopkeeper: {
          id: shopkeeper.id,
          name: shopkeeper.name,
          email: shopkeeper.email,
          shop_name: shopkeeper.shop_name,
          subscription_status: "active",
          last_payment_date: now,
          next_payment_due: nextPaymentDue,
          grace_period_end: gracePeriodEnd,
          payable_amount: 0,
        },
      });
    } catch (err) {
      console.error("Unsuspend shopkeeper error:", err);
      res.status(500).json({
        success: false,
        message: "Server error",
        error: err.message,
      });
    }
  }
);

// GET /api/admin/products - Get all shop-specific products
adminRouter.get("/products", verifyAdminToken, async (req, res) => {
  try {
    const [products] = await pool.execute(`
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
adminRouter.get(
  "/global-products/scale/:shopScale",
  verifyAdminToken,
  async (req, res) => {
    try {
      const { shopScale } = req.params;

      if (!["small", "medium", "large"].includes(shopScale)) {
        return res.status(400).json({
          success: false,
          message: "Invalid shop scale. Must be small, medium, or large",
        });
      }

      const [rows] = await pool.execute(
        `
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
    `,
        [JSON.stringify(shopScale)]
      );

      // Parse shop_scales for response
      const products = rows.map((product) => ({
        ...product,
        shopScales: product.shop_scales
          ? JSON.parse(product.shop_scales)
          : ["all"],
      }));

      res.json({ success: true, data: products, shopScale });
    } catch (err) {
      console.error("Get scale-specific products error:", err);
      res
        .status(500)
        .json({ success: false, message: "Server error", error: err.message });
    }
  }
);

// PUT /api/admin/shopkeepers/:id/scale - Update shopkeeper scale
adminRouter.put(
  "/shopkeepers/:id/scale",
  verifyAdminToken,
  async (req, res) => {
    try {
      const shopkeeperId = req.params.id;
      const { shop_scale } = req.body;

      if (!["small", "medium", "large"].includes(shop_scale)) {
        return res.status(400).json({
          success: false,
          message: "Invalid shop scale. Must be small, medium, or large",
        });
      }

      const [result] = await pool.execute(
        "UPDATE shopkeepers SET shop_scale = ? WHERE id = ?",
        [shop_scale, shopkeeperId]
      );

      if (result.affectedRows === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Shopkeeper not found" });
      }

      res.json({
        success: true,
        message: `Shopkeeper scale updated to ${shop_scale}`,
        shopkeeperId,
        shop_scale,
      });
    } catch (err) {
      console.error("Update shopkeeper scale error:", err);
      res
        .status(500)
        .json({ success: false, message: "Server error", error: err.message });
    }
  }
);

// GET /api/admin/order-items - Get all order items
adminRouter.get("/order-items", verifyAdminToken, async (req, res) => {
  try {
    const [orderItems] = await pool.execute(`
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
    const [admins] = await pool.execute(
      "SELECT id, email, created_at FROM admins ORDER BY created_at DESC"
    );
    res.json({ success: true, data: admins });
  } catch (err) {
    console.error("Get admins error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Fetch all orders (admin)
adminRouter.get("/orders", verifyAdminToken, async (req, res) => {
  try {
    const { status = "all" } = req.query;

    // Build WHERE clause for filtering
    let whereConditions = [];
    let queryParams = [];

    // Add status filter
    if (status && status !== "all") {
      if (status === "pending") {
        whereConditions.push("o.status IN ('Pending', 'Processing')");
      } else if (status === "completed") {
        whereConditions.push("o.status IN ('Completed', 'Delivered')");
      } else if (status === "cancelled") {
        whereConditions.push("o.status = 'Cancelled'");
      }
    }

    const whereClause =
      whereConditions.length > 0
        ? "WHERE " + whereConditions.join(" AND ")
        : "";

    // Get counts for all statuses
    const [counts] = await pool.execute(`
      SELECT 
        COUNT(*) as all_count,
        SUM(CASE WHEN o.status IN ('Pending', 'Processing') THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN o.status IN ('Completed', 'Delivered') THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN o.status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled_count
      FROM orders o
    `);

    // Fetch orders with details
    const [orders] = await pool.execute(
      `SELECT 
         o.id,
         o.user_id as userId,
         o.shopkeeper_id as shopkeeperId,
         CASE 
           WHEN o.status IN ('Completed', 'Delivered') THEN 'completed'
           WHEN o.status = 'Cancelled' THEN 'cancelled'
           ELSE 'pending'
         END as status,
         o.status as originalStatus,
         o.total_amount as totalAmount,
         o.credits_earned as creditsEarned,
         o.credits_used as creditsUsed,
         o.payment_method as paymentMethod,
         o.latitude,
         o.longitude,
         o.delivery_address as deliveryAddress,
         o.pickup_code as pickupCode,
         o.created_at as createdAt,
         u.name AS customerName,
         u.email AS customerEmail,
         u.phone AS customerPhone,
         s.shop_name as shopName,
         s.name AS shopkeeperName,
         s.phone as shopkeeperPhone,
         s.address as shopAddress
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       LEFT JOIN shopkeepers s ON o.shopkeeper_id = s.id
       ${whereClause}
       ORDER BY o.created_at DESC`,
      queryParams
    );

    // Fetch order items
    const orderIds = orders.map((o) => o.id);
    let itemsMap = {};

    if (orderIds.length) {
      const placeholders = orderIds.map(() => "?").join(",");
      const [items] = await pool.execute(
        `SELECT 
           oi.order_id,
           oi.product_id as productId,
           oi.quantity,
           oi.price,
           COALESCE(p.name, 'Product Unavailable') AS productName,
           p.image AS productImage,
           p.category as productCategory
         FROM order_items oi
         LEFT JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id IN (${placeholders})`,
        orderIds
      );

      items.forEach((item) => {
        if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
        itemsMap[item.order_id].push({
          productId: item.productId,
          productName: item.productName,
          productImage: item.productImage,
          productCategory: item.productCategory,
          quantity: item.quantity,
          price: parseFloat(item.price),
        });
      });
    }

    // Attach items to orders and format response
    const ordersWithItems = orders.map((order) => ({
      ...order,
      items: itemsMap[order.id] || [],
      totalAmount: parseFloat(order.totalAmount),
      creditsEarned: parseFloat(order.creditsEarned || 0),
      creditsUsed: parseInt(order.creditsUsed || 0),
    }));

    res.json({
      success: true,
      orders: ordersWithItems,
      counts: {
        all: parseInt(counts[0].all_count) || 0,
        pending: parseInt(counts[0].pending_count) || 0,
        completed: parseInt(counts[0].completed_count) || 0,
        cancelled: parseInt(counts[0].cancelled_count) || 0,
      },
    });
  } catch (err) {
    console.error("Admin get orders error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
});

// Update order status (admin)
adminRouter.patch("/orders/:id/status", verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate status
    const validStatuses = [
      "Pending",
      "Processing",
      "Completed",
      "Delivered",
      "Cancelled",
      "completed",
      "cancelled",
      "pending",
    ];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid status. Must be one of: Pending, Processing, Completed, Delivered, Cancelled",
      });
    }

    // Normalize status for database
    let dbStatus = status;
    if (status === "completed") dbStatus = "Completed";
    if (status === "cancelled") dbStatus = "Cancelled";
    if (status === "pending") dbStatus = "Pending";

    // Check if order exists
    const [orders] = await pool.execute("SELECT * FROM orders WHERE id = ?", [
      id,
    ]);
    if (orders.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    const order = orders[0];

    // Update order status
    await pool.execute("UPDATE orders SET status = ? WHERE id = ?", [
      dbStatus,
      id,
    ]);

    console.log(`📡 Admin updated order #${id} status to ${dbStatus}`);

    // Broadcast socket event to shopkeeper and customer
    if (global.io) {
      const socketPayload = {
        orderId: parseInt(id),
        order_id: parseInt(id),
        status: dbStatus,
        updatedBy: "admin",
        updated_by: "admin",
        timestamp: new Date().toISOString(),
      };

      // Emit to shopkeeper room
      if (order.shopkeeper_id) {
        global.io
          .to(`shopkeeper_${order.shopkeeper_id}`)
          .emit("orderStatusUpdate", socketPayload);
        console.log(
          `📡 Emitted orderStatusUpdate to shopkeeper_${order.shopkeeper_id}`
        );
      }

      // Emit to customer room
      if (order.user_id) {
        global.io
          .to(`user_${order.user_id}`)
          .emit("orderStatusUpdate", socketPayload);
        console.log(`📡 Emitted orderStatusUpdate to user_${order.user_id}`);
      }

      // Emit to admin room
      global.io.to("admin").emit("orderStatusUpdate", socketPayload);
      console.log(`📡 Emitted orderStatusUpdate to admin room`);
    }

    res.json({
      success: true,
      message: `Order status updated to ${dbStatus}`,
      order: {
        id: parseInt(id),
        status: dbStatus,
      },
    });
  } catch (err) {
    console.error("Admin update order status error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
});

// Fetch all orders (admin)
// adminRouter.get("/orders", verifyToken, async (req, res) => {
//   try {
//     const [orders] = await pool.execute(
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
//       const [items] = await pool.execute(
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
    const [tables] = await pool.execute("SHOW TABLES LIKE 'billing_payments'");

    if (tables.length === 0) {
      // Table doesn't exist, return empty array
      return res.json({
        success: true,
        data: [],
        message:
          "Payment system not yet configured. Please run the billing_payments.sql schema.",
      });
    }

    const [pendingRequests] = await pool.execute(`
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
    console.error("Get payment requests error:", err);
    // Return empty array instead of error for better UX
    res.json({ success: true, data: [], error: err.message });
  }
});

// PATCH /api/admin/payment-requests/:id - Process payment request
adminRouter.patch(
  "/payment-requests/:id",
  verifyAdminToken,
  async (req, res) => {
    try {
      const requestId = req.params.id;
      const { action, admin_notes } = req.body;

      if (!["approve", "reject"].includes(action)) {
        return res.status(400).json({
          success: false,
          message: "Invalid action. Use 'approve' or 'reject'",
        });
      }

      // Get payment details
      const [[payment]] = await pool.execute(
        `SELECT bp.*, s.created_at 
       FROM billing_payments bp
       JOIN shopkeepers s ON bp.shopkeeper_id = s.id
       WHERE bp.id = ?`,
        [requestId]
      );

      if (!payment) {
        return res.status(404).json({
          success: false,
          message: "Payment request not found",
        });
      }

      // Process payment approval/rejection
      if (action === "approve") {
        await pool.execute(
          `UPDATE billing_payments 
         SET status = 'approved', 
             notes = ?,
             approved_by = ?,
             approved_at = NOW()
         WHERE id = ?`,
          [admin_notes || "Payment approved", req.admin.id, requestId]
        );

        // Call processPaymentApproval to reset billing cycle
        await processPaymentApproval(payment.shopkeeper_id);

        return res.json({
          success: true,
          message:
            "Payment approved successfully. Billing cycle reset to 15 days.",
        });
      }

      // Handle rejection
      if (action === "reject") {
        await pool.execute(
          `UPDATE billing_payments 
         SET status = 'rejected', 
             notes = ?,
             approved_by = ?,
             approved_at = NOW()
         WHERE id = ?`,
          [admin_notes || "Payment rejected", req.admin.id, requestId]
        );

        return res.json({
          success: true,
          message: "Payment rejected successfully",
        });
      }
    } catch (err) {
      console.error("Process payment request error:", err);
      res
        .status(500)
        .json({ success: false, message: "Server error", error: err.message });
    }
  }
);

// GET /api/admin/payments/all - Get all payments (pending, approved, rejected)
adminRouter.get("/payments/all", verifyAdminToken, async (req, res) => {
  try {
    // Check if billing_payments table exists
    const [tables] = await pool.execute("SHOW TABLES LIKE 'billing_payments'");

    if (tables.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: "Payment system not yet configured.",
      });
    }

    const [payments] = await pool.execute(`
      SELECT 
        bp.id, 
        bp.shopkeeper_id, 
        bp.amount, 
        bp.payment_method, 
        bp.transaction_id, 
        bp.payment_date, 
        bp.status, 
        bp.notes,
        bp.approved_by,
        bp.approved_at,
        s.name as shopkeeper_name, 
        s.email as shopkeeper_email, 
        s.shop_name, 
        s.shop_scale
      FROM billing_payments bp
      LEFT JOIN shopkeepers s ON bp.shopkeeper_id = s.id
      ORDER BY bp.payment_date DESC
    `);

    res.json({ success: true, data: payments });
  } catch (err) {
    console.error("Get all payments error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
});

// GET /api/admin/earnings - Get earnings summary
adminRouter.get("/earnings", verifyAdminToken, async (req, res) => {
  try {
    // Check if billing_payments table exists
    const [tables] = await pool.execute("SHOW TABLES LIKE 'billing_payments'");

    let earningsData = [
      {
        pending_payments: 0,
        approved_payments: 0,
        pending_amount: 0,
        total_revenue: 0,
      },
    ];

    if (tables.length > 0) {
      // Get earnings summary from billing_payments
      const [data] = await pool.execute(`
        SELECT 
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_payments,
          COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_payments,
          COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) as pending_amount,
          COALESCE(SUM(CASE WHEN status = 'approved' THEN amount END), 0) as total_revenue
        FROM billing_payments
      `);
      earningsData = data;
    }

    // Get subscription stats from shopkeepers (no trial period)
    let subscriptionStats = {
      active_users: 0,
      overdue_users: 0,
      suspended_users: 0,
    };

    try {
      const [subData] = await pool.execute(`
        SELECT 
          0 as trial_users,
          COUNT(CASE WHEN subscription_status = 'active' OR subscription_status IS NULL THEN 1 END) as active_users,
          COUNT(CASE WHEN subscription_status = 'overdue' THEN 1 END) as overdue_users,
          COUNT(CASE WHEN subscription_status = 'suspended' THEN 1 END) as suspended_users
        FROM shopkeepers
      `);
      subscriptionStats = subData[0];
    } catch (subErr) {
      // subscription_status column might not exist, use defaults
      console.log("Subscription stats not available:", subErr.message);
    }

    res.json({
      success: true,
      data: {
        payments: earningsData[0],
        subscriptions: subscriptionStats,
      },
      earnings: [], // Empty array for frontend compatibility
    });
  } catch (err) {
    console.error("Get earnings error:", err);
    res.json({
      success: true,
      data: {
        payments: {
          pending_payments: 0,
          approved_payments: 0,
          pending_amount: 0,
          total_revenue: 0,
        },
        subscriptions: {
          active_users: 0,
          overdue_users: 0,
          suspended_users: 0,
        },
      },
      earnings: [],
    });
  }
});

// GET /api/admin/earnings/summary - Get earnings summary
adminRouter.get("/earnings/summary", verifyAdminToken, async (req, res) => {
  try {
    // Check if billing_payments table exists
    const [tables] = await pool.execute("SHOW TABLES LIKE 'billing_payments'");

    let earningsData = [
      {
        pending_payments: 0,
        approved_payments: 0,
        pending_amount: 0,
        total_revenue: 0,
      },
    ];

    if (tables.length > 0) {
      const [data] = await pool.execute(`
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
    let subscriptionData = [
      {
        active_users: 0,
        overdue_users: 0,
        suspended_users: 0,
      },
    ];

    try {
      const [subData] = await pool.execute(`
        SELECT 
          COUNT(CASE WHEN subscription_status = 'active' OR subscription_status IS NULL THEN 1 END) as active_users,
          COUNT(CASE WHEN subscription_status = 'overdue' THEN 1 END) as overdue_users,
          COUNT(CASE WHEN subscription_status = 'suspended' THEN 1 END) as suspended_users
        FROM shopkeepers
      `);
      subscriptionData = subData;
    } catch (subErr) {
      // subscription_status column might not exist
      console.log("Subscription stats not available:", subErr.message);
    }

    res.json({
      success: true,
      data: {
        payments: earningsData[0],
        subscriptions: subscriptionData[0],
      },
    });
  } catch (err) {
    console.error("Get earnings summary error:", err);
    res.json({
      success: true,
      data: {
        payments: {
          pending_payments: 0,
          approved_payments: 0,
          pending_amount: 0,
          total_revenue: 0,
        },
        subscriptions: {
          active_users: 0,
          overdue_users: 0,
          suspended_users: 0,
        },
      },
    });
  }
});

// Get admin by ID (protected) - keep this at the end
adminRouter.get("/:id", verifyAdminToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, email, created_at FROM admins WHERE id = ?",
      [req.params.id]
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Admin not found" });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
});

// Admin Login - Environment-based fallback for unusual admin table
adminRouter.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, message: "Email and password are required" });
  }

  try {
    console.log("🔍 Admin login attempt for:", email);

    // Since your admin table has unusual structure, use environment variables as fallback
    const envAdminEmail = process.env.ADMIN_EMAIL || "nexkirana@kirana.com";
    const envAdminPassword =
      process.env.ADMIN_PASSWORD || "qwI41L5U47RwaI47DasA";

    console.log("🔧 Using environment admin credentials");
    console.log("📧 Expected email:", envAdminEmail);

    // Check email match (flexible)
    const emailMatches =
      email.toLowerCase() === envAdminEmail.toLowerCase() ||
      (email.toLowerCase().includes("nexkirana") &&
        envAdminEmail.toLowerCase().includes("nexkirana")) ||
      (email.toLowerCase().includes("admin") &&
        envAdminEmail.toLowerCase().includes("admin"));

    if (!emailMatches) {
      console.log("📧 Email mismatch");
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    // Check password match
    const passwordMatches = password === envAdminPassword;

    if (!passwordMatches) {
      console.log("🔐 Password mismatch");
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    // Generate JWE token
    const token = await createJWEToken(
      {
        id: 1,
        email: envAdminEmail,
        role: "admin",
      },
      "24h"
    );

    console.log("✅ Environment-based admin login successful");
    res.json({
      success: true,
      token,
      admin: {
        id: 1,
        email: envAdminEmail,
      },
      message: "Admin login successful",
    });
  } catch (err) {
    console.error("❌ Admin login error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
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
      created_at: new Date().toISOString(), // Placeholder since we don't have DB record
    };

    res.json({ success: true, data: adminInfo });
  } catch (err) {
    console.error("Admin profile error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
});

// EARNINGS MANAGEMENT ENDPOINTS - DISABLED (Tables not available in current schema)
// Uncomment and modify these endpoints when earnings tables are added to the database

// GET /api/admin/shopkeeper-earnings - Get detailed shopkeeper earnings with stats
adminRouter.get("/shopkeeper-earnings", verifyAdminToken, async (req, res) => {
  try {
    // Get shopkeeper earnings from billing_payments
    const [shopkeeperEarnings] = await pool.execute(`
      SELECT 
        s.id as shopkeeper_id,
        s.name as shopkeeper_name,
        s.shop_name,
        s.email,
        s.phone,
        s.subscription_status,
        s.last_payment_date,
        s.next_payment_due,
        COUNT(CASE WHEN bp.status = 'pending' THEN 1 END) as pending_payments_count,
        COUNT(CASE WHEN bp.status = 'approved' THEN 1 END) as approved_payments_count,
        COUNT(CASE WHEN bp.status = 'rejected' THEN 1 END) as rejected_payments_count,
        COALESCE(SUM(CASE WHEN bp.status = 'pending' THEN bp.amount END), 0) as pending_amount,
        COALESCE(SUM(CASE WHEN bp.status = 'approved' THEN bp.amount END), 0) as total_paid,
        COALESCE(SUM(CASE WHEN bp.status = 'rejected' THEN bp.amount END), 0) as rejected_amount,
        MAX(CASE WHEN bp.status = 'approved' THEN bp.approved_at END) as last_payment_date_actual,
        COUNT(bp.id) as total_transactions
      FROM shopkeepers s
      LEFT JOIN billing_payments bp ON s.id = bp.shopkeeper_id
      WHERE s.is_deleted = 0 AND s.id IS NOT NULL
      GROUP BY s.id, s.name, s.shop_name, s.email, s.phone, s.subscription_status, s.last_payment_date, s.next_payment_due
      ORDER BY pending_amount DESC, s.name ASC
    `);

    // Calculate payment status for each shopkeeper and normalize subscription_status
    const enrichedEarnings = shopkeeperEarnings.map((earning) => {
      // No trial period - billing starts from day 1
      let subscription_status = earning.subscription_status;
      if (!subscription_status || subscription_status === "free") {
        subscription_status = "active";
      }

      let payment_status = "active";

      if (subscription_status === "suspended") {
        payment_status = "blocked";
      } else if (subscription_status === "overdue") {
        payment_status = "overdue";
      } else if (earning.next_payment_due) {
        const daysUntilDue = Math.ceil(
          (new Date(earning.next_payment_due) - new Date()) /
            (1000 * 60 * 60 * 24)
        );
        if (daysUntilDue <= 3 && daysUntilDue > 0) {
          payment_status = "due_soon";
        }
      }

      return {
        ...earning,
        subscription_status, // Use normalized status
        payment_status,
        next_payment_date: earning.next_payment_due,
      };
    });

    // Calculate summary stats with normalized statuses (no trial period)
    const summary = {
      total_shopkeepers: enrichedEarnings.length,
      total_pending: enrichedEarnings.reduce(
        (sum, e) => sum + Number(e.pending_amount),
        0
      ),
      total_paid: enrichedEarnings.reduce(
        (sum, e) => sum + Number(e.total_paid),
        0
      ),
      overdue_count: enrichedEarnings.filter(
        (e) => e.subscription_status === "overdue"
      ).length,
      due_soon_count: enrichedEarnings.filter(
        (e) => e.payment_status === "due_soon"
      ).length,
      active_count: enrichedEarnings.filter(
        (e) => e.subscription_status === "active"
      ).length,
      grace_count: enrichedEarnings.filter(
        (e) => e.subscription_status === "overdue"
      ).length,
      suspended_count: enrichedEarnings.filter(
        (e) => e.subscription_status === "suspended"
      ).length,
    };

    res.json({
      success: true,
      data: enrichedEarnings,
      summary,
      earnings: enrichedEarnings, // For backward compatibility
    });
  } catch (err) {
    console.error("Get shopkeeper earnings error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
});

/*
// Placeholder for earnings management - returns basic statistics instead
adminRouter.get("/earnings", verifyAdminToken, async (req, res) => {
  try {
    // Get basic order statistics instead of earnings
    const [orderStats] = await pool.execute(`
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
    const [payments] = await pool.execute(`
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
adminRouter.patch(
  "/payments/:id/status",
  verifyAdminToken,
  async (req, res) => {
    try {
      const paymentId = req.params.id;
      const { status, notes } = req.body; // 'approved' or 'rejected'

      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status must be 'approved' or 'rejected'",
        });
      }

      // Update payment status
      const [result] = await pool.execute(
        "UPDATE billing_payments SET status = ?, approved_by = ?, approved_at = NOW(), notes = ? WHERE id = ?",
        [status, req.admin.id, notes || "", paymentId]
      );

      if (result.affectedRows === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Payment not found" });
      }

      // If approved, update shopkeeper subscription using subscription utility
      if (status === "approved") {
        const [payment] = await pool.execute(
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
        message: `Payment ${status} successfully`,
      });
    } catch (err) {
      console.error("Update payment status error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// Get payment statistics
adminRouter.get("/payment-stats", verifyAdminToken, async (req, res) => {
  try {
    const [stats] = await pool.execute(`
      SELECT 
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_payments,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_payments,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_payments,
        SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END) as total_revenue,
        SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) as pending_amount
      FROM billing_payments
    `);

    const [subscriptionStats] = await pool.execute(`
      SELECT 
        COUNT(CASE WHEN subscription_status = 'active' THEN 1 END) as active_users,
        COUNT(CASE WHEN subscription_status = 'overdue' THEN 1 END) as overdue_users,
        COUNT(CASE WHEN subscription_status = 'suspended' THEN 1 END) as suspended_users
      FROM shopkeepers
    `);

    res.json({
      success: true,
      data: {
        payments: stats[0],
        subscriptions: subscriptionStats[0],
      },
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
    const [rows] = await pool
      .query("SELECT * FROM payment_info LIMIT 1")
      .catch(() => [[]]);

    if (rows.length === 0) {
      // Return default payment info structure
      return res.json({
        success: true,
        data: {
          upi_id: "",
          bank_account: "",
          ifsc_code: "",
          account_holder: "",
          qr_code: null,
        },
      });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("Payment info fetch error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
});

// GET /api/admin/payment-info/admin - Get admin payment information
adminRouter.get("/payment-info/admin", verifyAdminToken, async (req, res) => {
  try {
    // Return admin-specific payment info
    const [rows] = await pool
      .query("SELECT * FROM payment_info WHERE type = 'admin' LIMIT 1")
      .catch(() => [[]]);

    if (rows.length === 0) {
      return res.json({
        success: true,
        data: {
          upi_id: "",
          bank_account: "",
          ifsc_code: "",
          account_holder: "NexKirana Admin",
          qr_code: null,
          type: "admin",
        },
      });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("Admin payment info fetch error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
});

// PUT /api/admin/payment-info - Update payment information
adminRouter.put(
  "/payment-info",
  verifyAdminToken,
  upload.single("qr_code"),
  async (req, res) => {
    try {
      console.log("📝 Payment info update request received");
      console.log("Body:", req.body);
      console.log("File:", req.file ? "Present" : "None");
      console.log("Content-Type:", req.headers["content-type"]);

      // Check if req.body exists
      if (!req.body) {
        console.error("❌ req.body is undefined!");
        return res.status(400).json({
          success: false,
          message:
            "Request body is missing. Ensure Content-Type is multipart/form-data",
        });
      }

      const {
        upi_id,
        bank_account,
        bank_name,
        ifsc_code,
        account_holder,
        account_holder_name,
      } = req.body;
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
                resource_type: "image",
                folder: "nexkirana/payment-qr",
                transformation: [
                  { width: 500, height: 500, crop: "limit" },
                  { quality: "auto" },
                ],
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
          console.error("QR code upload error:", uploadError);
          return res.status(500).json({
            success: false,
            message: "Failed to upload QR code image",
          });
        }
      }

      // Note: Table should already exist from migration script
      // If it doesn't exist, the query below will fail with a clear error

      // Check if record exists
      const [existing] = await pool.execute(
        "SELECT id FROM payment_info WHERE type = 'admin' LIMIT 1"
      );

      if (existing.length > 0) {
        // Update existing record
        const updateFields = [];
        const updateValues = [];

        if (upi_id !== undefined) {
          updateFields.push("upi_id = ?");
          updateValues.push(upi_id);
        }
        if (bank_account !== undefined) {
          updateFields.push("bank_account = ?");
          updateValues.push(bank_account);
        }
        if (bank_name !== undefined) {
          updateFields.push("bank_name = ?");
          updateValues.push(bank_name);
        }
        if (ifsc_code !== undefined) {
          updateFields.push("ifsc_code = ?");
          updateValues.push(ifsc_code);
        }
        if (holderName !== undefined) {
          updateFields.push("account_holder = ?");
          updateValues.push(holderName);
        }
        if (qr_code_url) {
          updateFields.push("qr_code = ?");
          updateValues.push(qr_code_url);
        }

        // Ensure at least one field is being updated
        if (updateFields.length === 0) {
          return res.status(400).json({
            success: false,
            message: "No fields to update",
          });
        }

        updateValues.push(existing[0].id);

        await pool.execute(
          `UPDATE payment_info SET ${updateFields.join(", ")} WHERE id = ?`,
          updateValues
        );
      } else {
        // Insert new record
        await pool.execute(
          `INSERT INTO payment_info (upi_id, bank_account, bank_name, ifsc_code, account_holder, qr_code, type) 
         VALUES (?, ?, ?, ?, ?, ?, 'admin')`,
          [
            upi_id || "",
            bank_account || "",
            bank_name || "",
            ifsc_code || "",
            holderName || "NexKirana Admin",
            qr_code_url,
          ]
        );
      }

      res.json({
        success: true,
        message: "Payment information updated successfully",
        qr_code_url: qr_code_url,
      });
    } catch (err) {
      console.error("Payment info update error:", err);
      console.error("Error stack:", err.stack);
      res.status(500).json({
        success: false,
        message: "Server error",
        error: err.message,
        details: process.env.NODE_ENV === "development" ? err.stack : undefined,
      });
    }
  }
);

// Test endpoint to verify payment-info setup
adminRouter.get("/payment-info/test", verifyAdminToken, async (req, res) => {
  try {
    // Check table exists
    const [tables] = await pool.execute(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'payment_info'
    `);

    // Check columns
    const [columns] = await pool.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'payment_info'
    `);

    res.json({
      success: true,
      tableExists: tables.length > 0,
      columns: columns.map((c) => c.COLUMN_NAME),
      cloudinaryConfigured: !!(
        process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY
      ),
      uploadMiddleware: typeof upload === "function" ? "configured" : "missing",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ⚠️ CATCH-ALL ROUTES - MUST BE LAST! ⚠️
// These routes use /:id which matches any path, so they must be defined after all specific routes

// Update admin email or password (protected)
adminRouter.put("/:id", verifyAdminToken, async (req, res) => {
  const { email, password } = req.body;
  if (!email && !password) {
    return res
      .status(400)
      .json({ success: false, message: "Nothing to update" });
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
    const [result] = await pool.execute(
      `UPDATE admins SET ${updateFields.join(", ")} WHERE id = ?`,
      params
    );
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Admin not found" });
    }
    res.json({ success: true, message: "Admin updated" });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
});

// Delete admin (protected)
adminRouter.delete("/:id", verifyAdminToken, async (req, res) => {
  try {
    const [result] = await pool.execute("DELETE FROM admins WHERE id = ?", [
      req.params.id,
    ]);
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Admin not found" });
    }
    res.json({ success: true, message: "Admin deleted" });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
});

export default adminRouter;

// ============================================================================
// PUSH NOTIFICATIONS TO ALL USERS
// ============================================================================
// POST /api/admin/notifications/broadcast - Send push notification to all NexKirana users
adminRouter.post(
  "/notifications/broadcast",
  verifyAdminToken,
  async (req, res) => {
    try {
      const { title, body, data } = req.body;

      // Validate input
      if (!title || !body) {
        return res.status(400).json({
          success: false,
          message: "Title and body are required",
        });
      }

      console.log(
        `📢 Admin broadcasting notification to all users: "${title}"`
      );

      // Get all user FCM tokens from database
      let users;
      try {
        const [result] = await pool.execute(
          "SELECT id, name, expo_push_token as fcm_token FROM users WHERE expo_push_token IS NOT NULL AND expo_push_token != ''"
        );
        users = result;
      } catch (dbError) {
        console.error("Database query error:", dbError);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch users from database",
          error: dbError.message,
        });
      }

      if (!users || users.length === 0) {
        return res.json({
          success: true,
          message: "No users with FCM tokens found",
          stats: {
            totalUsers: 0,
            successCount: 0,
            failureCount: 0,
          },
        });
      }

      console.log(`📱 Found ${users.length} users with FCM tokens`);

      // Import FCM push utility
      const { sendFCMPush } = await import("../utils/fcmPush.js");

      // Extract tokens
      const tokens = users.map((u) => u.fcm_token);

      // Send notification to all users
      let result;
      try {
        result = await sendFCMPush(tokens, title, body, data || {});
      } catch (fcmError) {
        console.error("FCM Push error:", fcmError);
        return res.status(500).json({
          success: false,
          message: "Failed to send FCM notifications",
          error: fcmError.message,
        });
      }

      // Ensure result has required properties
      if (!result || typeof result !== "object") {
        console.error("Invalid result from sendFCMPush:", result);
        return res.status(500).json({
          success: false,
          message: "Invalid response from FCM service",
        });
      }

      // Clean up invalid tokens from database
      if (result.invalidTokens && result.invalidTokens.length > 0) {
        console.log(
          `🧹 Cleaning up ${result.invalidTokens.length} invalid tokens`
        );

        for (const invalidToken of result.invalidTokens) {
          try {
            await pool.execute(
              "UPDATE users SET expo_push_token = NULL WHERE expo_push_token = ?",
              [invalidToken]
            );
          } catch (updateError) {
            console.error(
              `Failed to clean up token: ${invalidToken}`,
              updateError
            );
          }
        }
      }

      console.log(
        `✅ Broadcast complete: ${result.successCount} sent, ${result.failureCount} failed`
      );

      res.json({
        success: true,
        message: `Notification sent to ${result.successCount} users`,
        stats: {
          totalUsers: users.length,
          successCount: result.successCount,
          failureCount: result.failureCount,
          invalidTokensRemoved: result.invalidTokens?.length || 0,
        },
        details: result,
      });
    } catch (err) {
      console.error("Broadcast notification error:", err);
      console.error("Error stack:", err.stack);
      res.status(500).json({
        success: false,
        message: "Failed to send broadcast notification",
        error: err.message,
        details: process.env.NODE_ENV === "development" ? err.stack : undefined,
      });
    }
  }
);

// GET /api/admin/notifications/stats - Get notification statistics
adminRouter.get("/notifications/stats", verifyAdminToken, async (req, res) => {
  try {
    // Get user statistics
    const [userStats] = await pool.execute(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN fcm_token IS NOT NULL AND fcm_token != '' THEN 1 END) as users_with_tokens,
        COUNT(CASE WHEN fcm_token IS NULL OR fcm_token = '' THEN 1 END) as users_without_tokens
      FROM users
    `);

    // Get shopkeeper statistics (optional, for future use)
    const [shopkeeperStats] = await pool.execute(`
      SELECT 
        COUNT(*) as total_shopkeepers,
        COUNT(CASE WHEN fcm_token IS NOT NULL AND fcm_token != '' THEN 1 END) as shopkeepers_with_tokens
      FROM shopkeepers
    `);

    res.json({
      success: true,
      data: {
        users: userStats[0],
        shopkeepers: shopkeeperStats[0],
      },
    });
  } catch (err) {
    console.error("Get notification stats error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to get notification statistics",
      error: err.message,
    });
  }
});
