import { verifyJWEToken } from "../utils/jweToken.js";

/**
 * Middleware specifically for handling "Order error" token expiration
 * This addresses the specific issue mentioned in the request
 */
export const handleOrderTokenExpiration = async (req, res, next) => {
  try {
    // Check if this is an order-related request
    const isOrderRequest = req.path.includes('/order') || 
                          req.path.includes('/cart') || 
                          req.path.includes('/checkout') ||
                          req.body?.action === 'place_order';

    if (!isOrderRequest) {
      return next();
    }

    const authHeader = req.headers["authorization"];
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Order error: Authentication required",
        code: "ORDER_AUTH_REQUIRED",
        action: "REDIRECT_TO_LOGIN",
        orderError: true
      });
    }

    const token = authHeader.split(" ")[1];

    try {
      // Verify the JWE token specifically for order operations
      const payload = await verifyJWEToken(token);
      
      // Check if token is close to expiration (within 1 hour for orders)
      const now = Math.floor(Date.now() / 1000);
      const timeUntilExpiry = payload.exp - now;
      
      if (timeUntilExpiry <= 0) {
        return res.status(401).json({
          success: false,
          message: "Order error: Your session has expired. Please login again to complete your order.",
          code: "ORDER_TOKEN_EXPIRED",
          action: "REDIRECT_TO_LOGIN",
          orderError: true,
          autoLogout: true,
          clearStorage: ['token', 'refreshToken', 'user', 'cart']
        });
      }

      // Warn if token expires soon (within 30 minutes)
      if (timeUntilExpiry < 30 * 60) {
        res.set('X-Order-Token-Warning', 'true');
        res.set('X-Token-Expires-In', Math.floor(timeUntilExpiry / 60) + 'm');
        res.set('X-Order-Message', 'Your session will expire soon. Please complete your order quickly.');
      }

      // Attach user info for order processing
      req.user = {
        id: payload.id,
        role: payload.role,
        exp: payload.exp,
        orderTokenValid: true
      };

      next();

    } catch (tokenError) {
      let message = "Order error: Invalid session";
      let code = "ORDER_INVALID_TOKEN";

      if (tokenError.message === 'TOKEN_EXPIRED') {
        message = "Order error: Your session has expired during order processing. Please login again.";
        code = "ORDER_TOKEN_EXPIRED";
      } else if (tokenError.message === 'TOKEN_REVOKED') {
        message = "Order error: Your session has been revoked. Please login again.";
        code = "ORDER_TOKEN_REVOKED";
      }

      return res.status(401).json({
        success: false,
        message,
        code,
        action: "REDIRECT_TO_LOGIN",
        orderError: true,
        autoLogout: true,
        clearStorage: ['token', 'refreshToken', 'user', 'cart'],
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Order token validation error:', error);
    return res.status(500).json({
      success: false,
      message: "Order error: Authentication service unavailable",
      code: "ORDER_AUTH_SERVICE_ERROR",
      action: "RETRY_OR_LOGIN",
      orderError: true
    });
  }
};

/**
 * Middleware to handle cart-specific token expiration
 */
export const handleCartTokenExpiration = async (req, res, next) => {
  try {
    const isCartRequest = req.path.includes('/cart') || 
                         req.body?.action?.includes('cart');

    if (!isCartRequest) {
      return next();
    }

    // For cart operations, we're more lenient with token expiration
    // but still need to validate the token
    const authHeader = req.headers["authorization"];
    
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      
      try {
        const payload = await verifyJWEToken(token);
        const now = Math.floor(Date.now() / 1000);
        const timeUntilExpiry = payload.exp - now;
        
        if (timeUntilExpiry <= 0) {
          return res.status(401).json({
            success: false,
            message: "Cart error: Session expired. Your cart items may be lost. Please login again.",
            code: "CART_TOKEN_EXPIRED",
            action: "REDIRECT_TO_LOGIN",
            cartError: true,
            autoLogout: true,
            saveCart: true // Hint to client to save cart before logout
          });
        }

        req.user = {
          id: payload.id,
          role: payload.role,
          exp: payload.exp
        };
      } catch (tokenError) {
        return res.status(401).json({
          success: false,
          message: "Cart error: Invalid session. Please login to access your cart.",
          code: "CART_INVALID_TOKEN",
          action: "REDIRECT_TO_LOGIN",
          cartError: true,
          autoLogout: true
        });
      }
    }

    next();
  } catch (error) {
    console.error('Cart token validation error:', error);
    next();
  }
};

/**
 * Global error handler for order-related errors
 */
export const orderErrorHandler = (error, req, res, next) => {
  // Check if this is an order-related error
  const isOrderError = req.path.includes('/order') || 
                      req.path.includes('/cart') || 
                      error.orderRelated;

  if (isOrderError) {
    if (error.message === 'TOKEN_EXPIRED' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: "Order error: Your session expired while processing the order. Please login again.",
        code: "ORDER_SESSION_EXPIRED",
        action: "REDIRECT_TO_LOGIN",
        orderError: true,
        autoLogout: true,
        clearStorage: ['token', 'refreshToken', 'user', 'cart'],
        timestamp: new Date().toISOString()
      });
    }

    if (error.message === 'TOKEN_REVOKED') {
      return res.status(401).json({
        success: false,
        message: "Order error: Your session has been revoked. Please login again to continue.",
        code: "ORDER_SESSION_REVOKED",
        action: "REDIRECT_TO_LOGIN",
        orderError: true,
        autoLogout: true,
        clearStorage: ['token', 'refreshToken', 'user', 'cart'],
        timestamp: new Date().toISOString()
      });
    }
  }

  next(error);
};