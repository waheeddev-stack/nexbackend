/**
 * Order Pre-fetch API Routes
 * 
 * These endpoints allow the frontend to pre-fetch and cache data
 * before order placement, reducing order processing time dramatically.
 * 
 * Usage:
 * 1. Call /prefetch/shop when user views a shop
 * 2. Call /prefetch/products when user adds items to cart
 * 3. Call /prefetch/user-points when user opens cart/checkout
 */

import express from "express";
import verifyToken from "../middleware/auth.js";
import {
  prefetchShopkeeperData,
  prefetchProductData,
  prefetchUserPoints,
  getCacheStats,
  clearAllCaches,
} from "../utils/orderPrefetchCache.js";

const router = express.Router();

/**
 * POST /api/prefetch/shop
 * Pre-fetch shopkeeper data
 */
router.post("/shop", verifyToken, async (req, res) => {
  try {
    const { shopkeeperId, shopId } = req.body;
    const id = shopkeeperId || shopId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Shopkeeper ID is required",
      });
    }

    const result = await prefetchShopkeeperData(id);
    
    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: result.error || "Failed to pre-fetch shopkeeper data",
      });
    }

    res.json({
      success: true,
      message: result.cached ? "Data retrieved from cache" : "Data pre-fetched successfully",
      cached: result.cached,
      data: {
        shopkeeperId: result.data.id,
        shopName: result.data.shop_name,
        isActive: result.data.subscription_status === 'active' && !result.data.is_deleted,
        subscriptionStatus: result.data.subscription_status,
      },
    });
  } catch (error) {
    console.error("Pre-fetch shop error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to pre-fetch shop data",
      error: error.message,
    });
  }
});

/**
 * POST /api/prefetch/products
 * Pre-fetch product data and stock
 */
router.post("/products", verifyToken, async (req, res) => {
  try {
    const { productIds, shopkeeperId, shopId } = req.body;
    const id = shopkeeperId || shopId;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Product IDs array is required",
      });
    }

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Shopkeeper ID is required",
      });
    }

    const result = await prefetchProductData(productIds, id);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error || "Failed to pre-fetch product data",
      });
    }

    // Return stock availability summary
    const stockSummary = {};
    for (const productId of productIds) {
      const product = result.data[productId];
      if (product) {
        stockSummary[productId] = {
          available: product.stock > 0,
          stock: product.stock,
          name: product.name,
        };
      } else {
        stockSummary[productId] = {
          available: false,
          stock: 0,
          name: "Unknown",
        };
      }
    }

    res.json({
      success: true,
      message: result.cached ? "Data retrieved from cache" : "Data pre-fetched successfully",
      cached: result.cached,
      stockSummary,
    });
  } catch (error) {
    console.error("Pre-fetch products error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to pre-fetch product data",
      error: error.message,
    });
  }
});

/**
 * POST /api/prefetch/user-points
 * Pre-fetch user wellness points
 */
router.post("/user-points", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await prefetchUserPoints(userId);
    
    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: result.error || "Failed to pre-fetch user points",
      });
    }

    res.json({
      success: true,
      message: result.cached ? "Data retrieved from cache" : "Data pre-fetched successfully",
      cached: result.cached,
      data: {
        storeCredits: result.data.storeCredits,
        availableForRedemption: Math.min(result.data.storeCredits, 1000), // Max 1000 points per order
      },
    });
  } catch (error) {
    console.error("Pre-fetch user points error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to pre-fetch user points",
      error: error.message,
    });
  }
});

/**
 * POST /api/prefetch/all
 * Pre-fetch all data needed for order placement
 */
router.post("/all", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { productIds, shopkeeperId, shopId } = req.body;
    const id = shopkeeperId || shopId;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Product IDs array is required",
      });
    }

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Shopkeeper ID is required",
      });
    }

    // Pre-fetch all data in parallel
    const [shopResult, productsResult, userResult] = await Promise.all([
      prefetchShopkeeperData(id),
      prefetchProductData(productIds, id),
      prefetchUserPoints(userId),
    ]);

    const allSuccess = shopResult.success && productsResult.success && userResult.success;

    if (!allSuccess) {
      return res.status(400).json({
        success: false,
        message: "Failed to pre-fetch some data",
        errors: {
          shop: shopResult.success ? null : shopResult.error,
          products: productsResult.success ? null : productsResult.error,
          user: userResult.success ? null : userResult.error,
        },
      });
    }

    res.json({
      success: true,
      message: "All data pre-fetched successfully",
      data: {
        shop: {
          isActive: shopResult.data.subscription_status === 'active' && !shopResult.data.is_deleted,
          cached: shopResult.cached,
        },
        products: {
          count: Object.keys(productsResult.data).length,
          cached: productsResult.cached,
        },
        user: {
          storeCredits: userResult.data.storeCredits,
          cached: userResult.cached,
        },
      },
    });
  } catch (error) {
    console.error("Pre-fetch all error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to pre-fetch data",
      error: error.message,
    });
  }
});

/**
 * GET /api/prefetch/stats
 * Get cache statistics (admin only)
 */
router.get("/stats", verifyToken, async (req, res) => {
  try {
    const stats = getCacheStats();
    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error("Get cache stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get cache stats",
      error: error.message,
    });
  }
});

/**
 * POST /api/prefetch/clear
 * Clear all caches (admin only)
 */
router.post("/clear", verifyToken, async (req, res) => {
  try {
    clearAllCaches();
    res.json({
      success: true,
      message: "All caches cleared successfully",
    });
  } catch (error) {
    console.error("Clear cache error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to clear caches",
      error: error.message,
    });
  }
});

export default router;
