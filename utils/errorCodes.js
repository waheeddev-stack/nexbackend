/**
 * CRITICAL FIX #8: Standardized Error Codes
 * Centralized error code mapping for consistent API responses
 */

export const ERROR_CODES = {
  // Authentication errors (4000-4099)
  NO_TOKEN: {
    code: 4001,
    status: 401,
    message: "No authentication token provided",
  },
  INVALID_TOKEN: {
    code: 4002,
    status: 401,
    message: "Invalid or expired token",
  },
  TOKEN_EXPIRED: { code: 4003, status: 401, message: "Token has expired" },
  INSUFFICIENT_PERMISSIONS: {
    code: 4004,
    status: 403,
    message: "Insufficient permissions",
  },

  // Order errors (4100-4199)
  ORDER_NOT_FOUND: { code: 4101, status: 404, message: "Order not found" },
  INVALID_ORDER_STATUS: {
    code: 4102,
    status: 400,
    message: "Invalid order status",
  },
  ORDER_ALREADY_COMPLETED: {
    code: 4103,
    status: 400,
    message: "Order already completed",
  },
  CANNOT_CANCEL_ORDER: {
    code: 4104,
    status: 400,
    message: "Cannot cancel this order",
  },
  DUPLICATE_ORDER: {
    code: 4105,
    status: 200,
    message: "Order already created",
  },

  // Stock errors (4200-4299)
  INSUFFICIENT_STOCK: {
    code: 4201,
    status: 400,
    message: "Insufficient stock",
  },
  PRODUCT_NOT_FOUND: { code: 4202, status: 404, message: "Product not found" },
  STOCK_VALIDATION_FAILED: {
    code: 4203,
    status: 400,
    message: "Stock validation failed",
  },

  // Shop errors (4300-4399)
  SHOP_NOT_FOUND: { code: 4301, status: 404, message: "Shop not found" },
  SHOP_INACTIVE: { code: 4302, status: 400, message: "Shop is inactive" },
  SHOP_DELETED: { code: 4303, status: 400, message: "Shop has been deleted" },
  SHOP_OFFLINE: {
    code: 4304,
    status: 400,
    message: "Shop is currently offline",
  },

  // Delivery errors (4400-4499)
  INVALID_DELIVERY_SLOT: {
    code: 4401,
    status: 400,
    message: "Invalid delivery slot",
  },
  DELIVERY_SLOT_UNAVAILABLE: {
    code: 4402,
    status: 400,
    message: "Delivery slot unavailable",
  },
  INVALID_ADDRESS: {
    code: 4403,
    status: 400,
    message: "Invalid delivery address",
  },

  // Payment errors (4500-4599)
  PAYMENT_FAILED: {
    code: 4501,
    status: 400,
    message: "Payment processing failed",
  },
  INVALID_PAYMENT_METHOD: {
    code: 4502,
    status: 400,
    message: "Invalid payment method",
  },
  INSUFFICIENT_CREDITS: {
    code: 4503,
    status: 400,
    message: "Insufficient store credits",
  },

  // Validation errors (4600-4699)
  INVALID_INPUT: { code: 4601, status: 400, message: "Invalid input data" },
  MISSING_REQUIRED_FIELD: {
    code: 4602,
    status: 400,
    message: "Missing required field",
  },
  INVALID_EMAIL: { code: 4603, status: 400, message: "Invalid email format" },

  // Server errors (5000-5099)
  INTERNAL_ERROR: { code: 5001, status: 500, message: "Internal server error" },
  DATABASE_ERROR: {
    code: 5002,
    status: 500,
    message: "Database operation failed",
  },
  EXTERNAL_SERVICE_ERROR: {
    code: 5003,
    status: 500,
    message: "External service error",
  },
};

/**
 * Create standardized error response
 * @param {string} errorCode - Error code key from ERROR_CODES
 * @param {object} additionalData - Additional data to include in response
 * @returns {object} Standardized error response
 */
export function createErrorResponse(errorCode, additionalData = {}) {
  const error = ERROR_CODES[errorCode] || ERROR_CODES.INTERNAL_ERROR;

  return {
    success: false,
    code: error.code,
    message: error.message,
    status: error.status,
    ...additionalData,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get HTTP status code for error
 * @param {string} errorCode - Error code key
 * @returns {number} HTTP status code
 */
export function getErrorStatus(errorCode) {
  const error = ERROR_CODES[errorCode] || ERROR_CODES.INTERNAL_ERROR;
  return error.status;
}

/**
 * Get error message for error code
 * @param {string} errorCode - Error code key
 * @returns {string} Error message
 */
export function getErrorMessage(errorCode) {
  const error = ERROR_CODES[errorCode] || ERROR_CODES.INTERNAL_ERROR;
  return error.message;
}

export default ERROR_CODES;
