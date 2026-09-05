import express from "express";
import db from "../config/db.js";
import verifyToken from "../middleware/auth.js";

const inventoryRouter = express.Router();

// PATCH /api/inventory/update-available-stock - Update product available stock status
inventoryRouter.patch(
  "/update-available-stock",
  verifyToken,
  async (req, res) => {
    try {
      const { product_id, shop_id, available_stock } = req.body;

      if (!product_id || !shop_id || !available_stock) {
        return res.status(400).json({
          success: false,
          message: "Product ID, shop ID, and available stock are required",
        });
      }

      const validStatuses = ["IN STOCK", "OUT OF STOCK", "INVISIBLE"];
      if (!validStatuses.includes(available_stock)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid available_stock value. Must be: IN STOCK, OUT OF STOCK, or INVISIBLE",
        });
      }

      const [currentProduct] = await db.query(
        "SELECT available_stock FROM products WHERE id = ? AND shop_id = ?",
        [product_id, shop_id]
      );

      if (currentProduct.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      const previousStatus = currentProduct[0].available_stock;

      await db.query(
        "UPDATE products SET available_stock = ? WHERE id = ? AND shop_id = ?",
        [available_stock, product_id, shop_id]
      );

      await db.query(
        `INSERT INTO inventory_logs (product_id, shop_id, action, previous_status, new_status, performed_by)
       VALUES (?, ?, 'status_change', ?, ?, ?)`,
        [
          product_id,
          shop_id,
          previousStatus,
          available_stock,
          req.user?.id || req.shopkeeper?.id,
        ]
      );

      res.json({
        success: true,
        message: "Available stock updated successfully",
        product: {
          id: product_id,
          previous_status: previousStatus,
          new_status: available_stock,
        },
      });
    } catch (error) {
      console.error("Available stock update error:", error);
      res.status(500).json({
        success: false,
        message: "Server error",
        error: error.message,
      });
    }
  }
);

// GET /api/inventory/by-available-stock - Get products by available stock with optional filtering
inventoryRouter.get("/by-available-stock", verifyToken, async (req, res) => {
  try {
    const { shop_id, available_stock, is_visible_only } = req.query;

    if (!shop_id) {
      return res.status(400).json({
        success: false,
        message: "Shop ID is required",
      });
    }

    let query = "SELECT * FROM products WHERE shop_id = ?";
    const params = [shop_id];

    if (available_stock && available_stock !== "all") {
      query += " AND available_stock = ?";
      params.push(available_stock);
    }

    if (is_visible_only === "true") {
      // is_visible column may not exist on older schemas — filter by INVISIBLE status instead
      query += " AND (available_stock IS NULL OR available_stock <> 'INVISIBLE')";
    }

    query += " ORDER BY created_at DESC";

    const [products] = await db.query(query, params);

    res.json({
      success: true,
      data: products,
    });
  } catch (error) {
    console.error("Available stock filter error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// GET /api/inventory/barcode/:barcode - Lookup a shop product by barcode
inventoryRouter.get("/barcode/:barcode", verifyToken, async (req, res) => {
  try {
    const { barcode } = req.params;
    const shopId = req.query.shop_id || req.user?.id || req.shopkeeper?.id;

    if (!barcode) {
      return res.status(400).json({
        success: false,
        message: "Barcode is required",
      });
    }

    if (!shopId) {
      return res.status(400).json({
        success: false,
        message: "Shop ID is required",
      });
    }

    let products = [];
    try {
      const [rows] = await db.query(
        "SELECT * FROM products WHERE barcode = ? AND shop_id = ? LIMIT 1",
        [barcode, shopId]
      );
      products = rows;
    } catch (dbError) {
      // Barcode column may not exist yet on this schema - treat as no match
      // so the client falls back to manual product entry.
      if (
        dbError.code === "ER_BAD_FIELD_ERROR" ||
        /unknown column/i.test(dbError.message || "")
      ) {
        return res.json({
          success: true,
          product: null,
          source: "no_barcode_support",
          message: "Barcode column not available",
        });
      }
      throw dbError;
    }

    if (products.length === 0) {
      return res.json({
        success: true,
        product: null,
        source: "not_found",
        message: "No shop product matches this barcode",
      });
    }

    res.json({
      success: true,
      product: products[0],
      source: "shop_product",
    });
  } catch (error) {
    console.error("Barcode lookup error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// GET /api/inventory/history/:productId - Get inventory history for a product
inventoryRouter.get("/history/:productId", verifyToken, async (req, res) => {
  try {
    const { productId } = req.params;

    const [logs] = await db.query(
      `SELECT il.*, p.name as product_name, s.shop_name
       FROM inventory_logs il
       LEFT JOIN products p ON il.product_id = p.id
       LEFT JOIN shopkeepers s ON il.shop_id = s.id
       WHERE il.product_id = ?
       ORDER BY il.created_at DESC
       LIMIT 50`,
      [productId]
    );

    res.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    console.error("Inventory history error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// POST /api/inventory/price-update - Update product price (missing endpoint for shopkeeper inventoryApi)
inventoryRouter.post("/price-update", verifyToken, async (req, res) => {
  try {
    const { product_id, new_price, shop_id } = req.body;
    const resolvedShopId = shop_id || req.user?.id || req.shopkeeper?.id;
    if (!product_id || new_price == null) {
      return res.status(400).json({ success: false, message: "product_id and new_price are required" });
    }
    const parsedPrice = Number(new_price);
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({ success: false, message: "Invalid price" });
    }
    if (!resolvedShopId) {
      return res.status(400).json({ success: false, message: "shop_id could not be determined from token" });
    }
    const [rows] = await db.query("SELECT * FROM products WHERE id = ? AND shop_id = ?", [product_id, resolvedShopId]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: "Product not found" });
    const product = rows[0];
    if (product.mrp != null && parsedPrice > Number(product.mrp)) {
      return res.status(400).json({ success: false, message: "Selling price cannot exceed MRP" });
    }
    const previousPrice = product.price;
    await db.query("UPDATE products SET price = ? WHERE id = ? AND shop_id = ?", [parsedPrice, product_id, resolvedShopId]);
    try {
      await db.query(`INSERT INTO price_history (product_id, shop_id, old_price, new_price, changed_by) VALUES (?, ?, ?, ?, ?)`, [product_id, resolvedShopId, previousPrice, parsedPrice, req.user?.id || req.shopkeeper?.id]);
    } catch (_) {
      try { await db.query(`INSERT INTO inventory_logs (product_id, shop_id, action, previous_status, new_status, performed_by) VALUES (?, ?, 'price_change', ?, ?, ?)`, [product_id, resolvedShopId, String(previousPrice), String(parsedPrice), req.user?.id]); } catch {}
    }
    const [updated] = await db.query("SELECT * FROM products WHERE id = ? AND shop_id = ?", [product_id, resolvedShopId]);
    res.json({ success: true, message: "Price updated", product: updated[0], previous_price: previousPrice, new_price: parsedPrice });
  } catch (error) {
    console.error("Price update error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

// GET /api/inventory/price-history/:productId - Price change history
inventoryRouter.get("/price-history/:productId", verifyToken, async (req, res) => {
  try {
    const { productId } = req.params;
    let logs = [];
    try {
      const [rows] = await db.query(`SELECT * FROM price_history WHERE product_id = ? ORDER BY created_at DESC LIMIT 50`, [productId]);
      logs = rows;
    } catch {
      const [rows2] = await db.query(`SELECT il.*, p.name as product_name FROM inventory_logs il LEFT JOIN products p ON il.product_id = p.id WHERE il.product_id = ? AND il.action = 'price_change' ORDER BY il.created_at DESC LIMIT 50`, [productId]);
      logs = rows2;
    }
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error("Price history error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

// GET /api/inventory/low-stock/:shopId - Low stock products
inventoryRouter.get("/low-stock/:shopId", verifyToken, async (req, res) => {
  try {
    const { shopId } = req.params;
    const threshold = parseInt(req.query.threshold || "3", 10);
    if (!shopId) return res.status(400).json({ success: false, message: "shopId is required" });
    const [products] = await db.query(`SELECT * FROM products WHERE shop_id = ? AND stock <= ? ORDER BY stock ASC`, [shopId, threshold]);
    res.json({ success: true, data: products, threshold });
  } catch (error) {
    console.error("Low stock error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

// POST /api/inventory/restock - Restock a product
inventoryRouter.post("/restock", verifyToken, async (req, res) => {
  try {
    const { barcode, quantity } = req.body;
    // ✅ FIX: derive shop from the authenticated token instead of trusting
    // the client body (prevents restocking another shop's products).
    const shop_id = req.user?.id || req.shopkeeper?.id;

    if (!barcode || !quantity) {
      return res.status(400).json({
        success: false,
        message: "Barcode and quantity are required",
      });
    }

    if (!shop_id) {
      return res.status(400).json({
        success: false,
        message: "Shop ID could not be determined from token",
      });
    }

    const [products] = await db.query(
      "SELECT * FROM products WHERE barcode = ? AND shop_id = ?",
      [barcode, shop_id]
    );

    if (products.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const product = products[0];
    const newStock = product.stock + parseInt(quantity);

    await db.query("UPDATE products SET stock = ? WHERE id = ?", [
      newStock,
      product.id,
    ]);

    const restockStatus = newStock === 0 ? "OUT OF STOCK" : "IN STOCK";
    await db.query(
      `UPDATE products SET available_stock = ? WHERE id = ? AND available_stock <> 'INVISIBLE'`,
      [restockStatus, product.id]
    );

    await db.query(
      `INSERT INTO inventory_logs (product_id, shop_id, action, quantity, previous_stock, new_stock, performed_by)
       VALUES (?, ?, 'restock', ?, ?, ?, ?)`,
      [
        product.id,
        shop_id,
        quantity,
        product.stock,
        newStock,
        req.user?.id || req.shopkeeper?.id,
      ]
    );

    res.json({
      success: true,
      message: "Stock updated successfully",
      product: {
        id: product.id,
        name: product.name,
        previous_stock: product.stock,
        new_stock: newStock,
        quantity_added: quantity,
      },
    });
  } catch (error) {
    console.error("Restock error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

export default inventoryRouter;
