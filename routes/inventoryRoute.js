import express from "express";
import db from "../config/db.js";
import verifyToken from "../middleware/auth.js";

const inventoryRouter = express.Router();

// GET /api/inventory/barcode/:code - Lookup product by barcode
inventoryRouter.get("/barcode/:code", verifyToken, async (req, res) => {
  try {
    const { code } = req.params;

    // Check in shop-specific products first
    const [shopProducts] = await db.query(
      `SELECT p.*, s.shop_name, s.name as shopkeeper_name 
       FROM products p 
       LEFT JOIN shopkeepers s ON p.shop_id = s.id 
       WHERE p.barcode = ?`,
      [code]
    );

    if (shopProducts.length > 0) {
      return res.json({
        success: true,
        product: shopProducts[0],
        source: "shop_product",
      });
    }

    // Check in global products
    const [globalProducts] = await db.query(
      "SELECT * FROM global_products WHERE barcode = ?",
      [code]
    );

    if (globalProducts.length > 0) {
      return res.json({
        success: true,
        product: globalProducts[0],
        source: "global_product",
      });
    }

    res.status(404).json({
      success: false,
      message: "Product not found with this barcode",
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

// POST /api/inventory/restock - Restock a product
inventoryRouter.post("/restock", verifyToken, async (req, res) => {
  try {
    const { barcode, quantity } = req.body;
    const shop_id = req.body.shop_id || req.user?.id;

    if (!barcode || !quantity) {
      return res.status(400).json({
        success: false,
        message: "Barcode and quantity are required",
      });
    }

    // Find product by barcode or name
    const [products] = await db.query(
      "SELECT * FROM products WHERE (barcode = ? OR name = ?) AND shop_id = ?",
      [barcode, barcode, shop_id]
    );

    if (products.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const product = products[0];
    const newStock = product.stock + parseInt(quantity);

    // Update stock
    await db.query("UPDATE products SET stock = ? WHERE id = ?", [
      newStock,
      product.id,
    ]);

    // Log restock activity
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

// POST /api/inventory/price-update - Update product price and log history
inventoryRouter.post("/price-update", verifyToken, async (req, res) => {
  try {
    const { product_id, new_price, shop_id } = req.body;

    if (!product_id || !new_price) {
      return res.status(400).json({
        success: false,
        message: "Product ID and new price are required",
      });
    }

    // Get current product
    const [products] = await db.query(
      "SELECT * FROM products WHERE id = ? AND shop_id = ?",
      [product_id, shop_id]
    );

    if (products.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const product = products[0];

    // Update price
    await db.query("UPDATE products SET price = ? WHERE id = ?", [
      new_price,
      product_id,
    ]);

    // Log price change
    await db.query(
      `INSERT INTO price_history (product_id, shop_id, old_price, new_price, changed_by)
       VALUES (?, ?, ?, ?, ?)`,
      [
        product_id,
        shop_id,
        product.price,
        new_price,
        req.user?.id || req.shopkeeper?.id,
      ]
    );

    res.json({
      success: true,
      message: "Price updated successfully",
      product: {
        id: product.id,
        name: product.name,
        old_price: product.price,
        new_price: new_price,
      },
    });
  } catch (error) {
    console.error("Price update error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// GET /api/inventory/price-history/:productId - Get price history
inventoryRouter.get(
  "/price-history/:productId",
  verifyToken,
  async (req, res) => {
    try {
      const { productId } = req.params;

      const [history] = await db.query(
        `SELECT ph.*, p.name as product_name, s.shop_name
       FROM price_history ph
       LEFT JOIN products p ON ph.product_id = p.id
       LEFT JOIN shopkeepers s ON ph.shop_id = s.id
       WHERE ph.product_id = ?
       ORDER BY ph.created_at DESC
       LIMIT 50`,
        [productId]
      );

      res.json({
        success: true,
        data: history,
      });
    } catch (error) {
      console.error("Price history error:", error);
      res.status(500).json({
        success: false,
        message: "Server error",
        error: error.message,
      });
    }
  }
);

// GET /api/inventory/low-stock/:shopId - Get low stock products
inventoryRouter.get("/low-stock/:shopId", verifyToken, async (req, res) => {
  try {
    const { shopId } = req.params;
    const threshold = req.query.threshold || 10;

    const [products] = await db.query(
      `SELECT p.*, s.shop_name
       FROM products p
       LEFT JOIN shopkeepers s ON p.shop_id = s.id
       WHERE p.shop_id = ? AND p.stock <= ?
       ORDER BY p.stock ASC`,
      [shopId, threshold]
    );

    res.json({
      success: true,
      data: products,
      count: products.length,
    });
  } catch (error) {
    console.error("Low stock error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

export default inventoryRouter;
