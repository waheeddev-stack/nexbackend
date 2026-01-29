import express from "express";
import verifyToken from "../middleware/auth.js";
import { handleOrderTokenExpiration, handleCartTokenExpiration, orderErrorHandler } from "../middleware/orderErrorHandler.js";
import { refreshTokenIfNeeded } from "../middleware/tokenRefresh.js";

const router = express.Router();

// Apply order-specific middleware
router.use(refreshTokenIfNeeded);
router.use(handleOrderTokenExpiration);
router.use(handleCartTokenExpiration);

// Placeholder routes for orders with proper error handling
router.get("/", verifyToken, (req, res) => {
  res.json({ 
    success: true, 
    message: "Orders route working",
    user: req.user,
    tokenValid: true
  });
});

// Example order creation route with enhanced error handling
router.post("/create", verifyToken, async (req, res) => {
  try {
    // Order creation logic would go here
    res.json({
      success: true,
      message: "Order created successfully",
      orderId: "ORDER_" + Date.now(),
      user: req.user
    });
  } catch (error) {
    error.orderRelated = true; // Mark as order-related error
    throw error;
  }
});

// Cart routes with specific error handling
router.get("/cart", handleCartTokenExpiration, verifyToken, (req, res) => {
  res.json({
    success: true,
    message: "Cart retrieved successfully",
    cart: [],
    user: req.user
  });
});

router.post("/cart/add", handleCartTokenExpiration, verifyToken, (req, res) => {
  res.json({
    success: true,
    message: "Item added to cart",
    user: req.user
  });
});

// Apply order error handler
router.use(orderErrorHandler);

export default router;