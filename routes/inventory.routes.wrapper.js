/**
 * Inventory Routes Wrapper
 *
 * This module wraps inventorymng routes and integrates them with nexbackend.
 * It applies nexbackend's authentication and follows its routing conventions.
 *
 * CRITICAL: Does NOT modify existing routes, only wraps and extends them.
 */

import express from "express";
import verifyToken from "../middleware/auth.js";
import { getInventoryDB } from "../config/inventory.db.bridge.js";
import {
  createInventoryProduct,
  updateInventoryStock,
  getInventoryProduct,
} from "../utils/inventory.service.bridge.js";

const router = express.Router();

/**
 * POST /api/inventory-mgmt/create-product
 * Create a new inventory product (from inventorymng/routes/testRoutes.js)
 */
router.post("/create-product", verifyToken, async (req, res) => {
  try {
    const { name, stock, baselineQty } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Product name is required",
      });
    }

    const product = await createInventoryProduct({
      name,
      stock: stock || 0,
      baselineQty: baselineQty || stock || 0,
    });

    res.json({
      success: true,
      message: "Inventory product created",
      product: {
        id: product.id,
        name: product.name,
        stock: product.stock,
        baselineQty: product.baselineQty,
        restockAt: product.restockAt,
      },
    });
  } catch (error) {
    console.error("❌ Create inventory product error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create inventory product",
      error: error.message,
    });
  }
});

/**
 * POST /api/inventory-mgmt/buy
 * Simulate product purchase - reduces stock (from inventorymng/routes/testRoutes.js)
 */
router.post("/buy", verifyToken, async (req, res) => {
  try {
    const { productId, quantity } = req.body;

    if (!productId || !quantity) {
      return res.status(400).json({
        success: false,
        message: "Product ID and quantity are required",
      });
    }

    const product = await getInventoryProduct(productId);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (product.stock < quantity) {
      return res.status(400).json({
        success: false,
        message: "Insufficient stock",
        available: product.stock,
        requested: quantity,
      });
    }

    // Deduct stock
    const result = await updateInventoryStock(productId, quantity, "SUBTRACT");

    res.json({
      success: true,
      message: "Purchase successful",
      product: result.product,
    });
  } catch (error) {
    console.error("❌ Buy product error:", error);
    res.status(500).json({
      success: false,
      message: "Purchase failed",
      error: error.message,
    });
  }
});

/**
 * GET /api/inventory-mgmt/product/:id
 * Get inventory product details (from inventorymng/routes/testRoutes.js)
 */
router.get("/product/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const product = await getInventoryProduct(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json({
      success: true,
      product: {
        id: product.id,
        name: product.name,
        stock: product.stock,
        baselineQty: product.baselineQty,
        restockAt: product.restockAt,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      },
    });
  } catch (error) {
    console.error("❌ Get product error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get product",
      error: error.message,
    });
  }
});

/**
 * GET /api/inventory-mgmt/products
 * List all inventory products
 */
router.get("/products", verifyToken, async (req, res) => {
  try {
    const { models } = await getInventoryDB();
    const products = await models.InventoryProduct.findAll({
      order: [["createdAt", "DESC"]],
    });

    res.json({
      success: true,
      count: products.length,
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        stock: p.stock,
        baselineQty: p.baselineQty,
        restockAt: p.restockAt,
        needsRestock: p.stock === 0 && p.restockAt !== null,
      })),
    });
  } catch (error) {
    console.error("❌ List products error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to list products",
      error: error.message,
    });
  }
});

/**
 * POST /api/inventory-mgmt/restock/:id
 * Manually restock a product
 */
router.post("/restock/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;

    if (!quantity || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid quantity is required",
      });
    }

    const result = await updateInventoryStock(id, quantity, "ADD");

    res.json({
      success: true,
      message: "Product restocked successfully",
      product: result.product,
    });
  } catch (error) {
    console.error("❌ Restock error:", error);
    res.status(500).json({
      success: false,
      message: "Restock failed",
      error: error.message,
    });
  }
});

/**
 * GET /api/inventory-mgmt/low-stock
 * Get products with low or zero stock
 */
router.get("/low-stock", verifyToken, async (req, res) => {
  try {
    const { models } = await getInventoryDB();
    const threshold = parseInt(req.query.threshold) || 10;

    const products = await models.InventoryProduct.findAll({
      where: {
        stock: {
          [models.InventoryProduct.sequelize.Sequelize.Op.lte]: threshold,
        },
      },
      order: [["stock", "ASC"]],
    });

    res.json({
      success: true,
      threshold,
      count: products.length,
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        stock: p.stock,
        baselineQty: p.baselineQty,
        restockAt: p.restockAt,
        needsRestock: p.stock === 0 && p.restockAt !== null,
      })),
    });
  } catch (error) {
    console.error("❌ Low stock query error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get low stock products",
      error: error.message,
    });
  }
});

export default router;
