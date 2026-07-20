import express from "express";
import db from "../config/db.js";
import verifyToken from "../middleware/auth.js";

const inventoryRouter = express.Router();

// PATCH /api/inventory/update-available-stock - Update product available stock status
inventoryRouter.patch('/update-available-stock', verifyToken, async (req, res) => {
  try {
    const { product_id, shop_id, available_stock } = req.body;

    if (!product_id || !shop_id || !available_stock) {
      return res.status(400).json({
        success: false,
        message: 'Product ID, shop ID, and available stock are required',
      });
    }

    const validStatuses = ['IN STOCK', 'OUT OF STOCK', 'INVISIBLE'];
    if (!validStatuses.includes(available_stock)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid available_stock value. Must be: IN STOCK, OUT OF STOCK, or INVISIBLE',
      });
    }

    const [currentProduct] = await db.query('SELECT available_stock FROM products WHERE id = ? AND shop_id = ?', [product_id, shop_id]);

    if (currentProduct.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    const previousStatus = currentProduct[0].available_stock;

    await db.query('UPDATE products SET available_stock = ? WHERE id = ? AND shop_id = ?', [available_stock, product_id, shop_id]);

    await db.query(
      `INSERT INTO inventory_logs (product_id, shop_id, action, previous_status, new_status, performed_by)
       VALUES (?, ?, 'status_change', ?, ?, ?)`,
      [product_id, shop_id, previousStatus, available_stock, req.user?.id || req.shopkeeper?.id]
    );

    res.json({
      success: true,
      message: 'Available stock updated successfully',
      product: {
        id: product_id,
        previous_status: previousStatus,
        new_status: available_stock
      }
    });
  } catch (error) {
    console.error('Available stock update error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// GET /api/inventory/by-available-stock - Get products by available stock with optional filtering
inventoryRouter.get('/by-available-stock', verifyToken, async (req, res) => {
  try {
    const { shop_id, available_stock, is_visible_only } = req.query;

    if (!shop_id) {
      return res.status(400).json({
        success: false,
        message: 'Shop ID is required',
      });
    }

    let query = 'SELECT * FROM products WHERE shop_id = ?';
    const params = [shop_id];

    if (available_stock && available_stock !== 'all') {
      query += ' AND available_stock = ?';
      params.push(available_stock);
    }

    if (is_visible_only === 'true') {
      query += ' AND is_visible = 1';
    }

    query += ' ORDER BY created_at DESC';

    const [products] = await db.query(query, params);

    res.json({
      success: true,
      data: products
    });
  } catch (error) {
    console.error('Available stock filter error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
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

// POST /api/inventory/restock - Restock a product
inventoryRouter.post("/restock", verifyToken, async (req, res) => {
  try {
    const { barcode, quantity, shop_id } = req.body;

    if (!barcode || !quantity) {
      return res.status(400).json({
        success: false,
        message: "Barcode and quantity are required",
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

module.exports = inventoryRouter;
