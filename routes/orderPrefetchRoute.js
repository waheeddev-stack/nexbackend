/**
 * Order Prefetch Routes
 *
 * These endpoints allow the frontend to pre-fetch and cache data
 * needed for fast order placement.
 */

import express from "express";
import verifyToken from "../middleware/auth.js";
import {
  prefetchUserData,
  prefetchShopProducts,
  prefetchOrderData,
  getCachedShopkeeper,
  getCachedShopProducts,
  getCachedUser,
} from "../services/orderPrefetch.service.js";

const router = express.Router();

// ============================================================================
// PREFETCH USER DATA
// ============================================================================
// GET /api/prefetch/user
// Call this when user logs in or opens app
router.get("/user", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await prefetchUserData(userId);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: result.error || "Failed to prefetch user data",
      });
    }

    res.json({
      success: true,
      message: "User data prefetched successfully",
      cached: true,
    });
  } catch (error) {
    console.error("Prefetch user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to prefetch user data",
    });
  }
});

// ============================================================================
// PREFETCH SHOP DATA
// ============================================================================
// GET /api/prefetch/shop/:shopId
// Call this when user views a shop or adds items to cart
router.get("/shop/:shopId", verifyToken, async (req, res) => {
  try {
    const { shopId } = req.params;
    const result = await prefetchShopProducts(parseInt(shopId));

    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: result.error || "Failed to prefetch shop data",
      });
    }

    res.json({
      success: true,
      message: "Shop data prefetched successfully",
      productCount: result.count,
      cached: true,
    });
  } catch (error) {
    console.error("Prefetch shop error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to prefetch shop data",
    });
  }
});

// ============================================================================
// PREFETCH ORDER DATA (COMBINED)
// ============================================================================
// POST /api/prefetch/order
// Call this when user is about to place an order
// Body: { shopkeeperId: number }
router.post("/order", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { shopkeeperId } = req.body;

    if (!shopkeeperId) {
      return res.status(400).json({
        success: false,
        message: "shopkeeperId is required",
      });
    }

    const result = await prefetchOrderData(userId, shopkeeperId);

    res.json({
      success: true,
      message: "Order data prefetched successfully",
      cached: result,
    });
  } catch (error) {
    console.error("Prefetch order error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to prefetch order data",
    });
  }
});

// ============================================================================
// GET CACHED DATA STATUS
// ============================================================================
// GET /api/prefetch/status
// Check what data is currently cached
router.get("/status", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { shopId } = req.query;

    const status = {
      user: !!getCachedUser(userId),
      shop: shopId ? !!getCachedShopkeeper(parseInt(shopId)) : false,
      products: shopId ? !!getCachedShopProducts(parseInt(shopId)) : false,
    };

    res.json({
      success: true,
      cached: status,
      message: "Cache status retrieved",
    });
  } catch (error) {
    console.error("Cache status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get cache status",
    });
  }
});

export default router;
