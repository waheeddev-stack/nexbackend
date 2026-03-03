// Application-wide constants
// Centralized configuration for easy maintenance

// ==================== ORDER CONSTANTS ====================

// Timer duration for Click & Collect orders (in seconds)
export const TIMER_DURATION_SECONDS = 420; // 7 minutes

// Minimum order amount to earn wellness points (in rupees)
export const MINIMUM_ORDER_AMOUNT = 40;

// Pickup code length (digits)
export const PICKUP_CODE_LENGTH = 6;

// ==================== WELLNESS POINTS CONSTANTS ====================

// Point value in rupees
export const POINT_VALUE_RUPEES = 0.05; // ₹0.05 per point

// Maximum percentage of order value that can be paid with points
export const MAX_POINTS_USAGE_PERCENTAGE = 30; // 30%

// Wellness point tiers based on time remaining (in minutes)
export const WELLNESS_TIERS = {
  SUPER_FAST: { minMinutes: 5, points: 40, label: "Super Fast" },
  GOOD_PACE: { minMinutes: 2, points: 30, label: "Good Pace" },
  ON_TIME: { minMinutes: 0, points: 10, label: "On Time" },
  LATE_BUT_ACTIVE: { minMinutes: -Infinity, points: 5, label: "Late but Active" }
};

// ==================== DELIVERY CONSTANTS ====================

// Delivery fee for home delivery (in rupees)
export const DELIVERY_FEE = 0;

// Time slot configuration
export const TIME_SLOT_CONFIG = {
  START_HOUR: 10, // 10 AM
  END_HOUR: 21,   // 9 PM
  INTERVAL_MINUTES: 30
};

// ==================== ORDER STATUS CONSTANTS ====================

export const ORDER_STATUS = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled"
};

export const VALID_ORDER_STATUSES = Object.values(ORDER_STATUS);

// ==================== VALIDATION CONSTANTS ====================

// Maximum length for cancellation reason
export const MAX_CANCELLATION_REASON_LENGTH = 500;

// Phone number validation
export const PHONE_NUMBER_REGEX = /^\d{10}$/;

// Pickup code validation
export const PICKUP_CODE_REGEX = /^\d{6}$/;

// ==================== RATE LIMITING CONSTANTS ====================

// Verification endpoint rate limiting
export const VERIFICATION_RATE_LIMIT = {
  WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  MAX_ATTEMPTS: 10 // 10 attempts per window
};

// ==================== NOTIFICATION CONSTANTS ====================

// Push notification retry configuration
export const PUSH_NOTIFICATION_CONFIG = {
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000
};

// ==================== DATABASE CONSTANTS ====================

// Query timeout (in milliseconds)
export const DB_QUERY_TIMEOUT = 30000; // 30 seconds

// ==================== EXPORT DEFAULT ====================

export default {
  TIMER_DURATION_SECONDS,
  MINIMUM_ORDER_AMOUNT,
  PICKUP_CODE_LENGTH,
  POINT_VALUE_RUPEES,
  MAX_POINTS_USAGE_PERCENTAGE,
  WELLNESS_TIERS,
  DELIVERY_FEE,
  TIME_SLOT_CONFIG,
  ORDER_STATUS,
  VALID_ORDER_STATUSES,
  MAX_CANCELLATION_REASON_LENGTH,
  PHONE_NUMBER_REGEX,
  PICKUP_CODE_REGEX,
  VERIFICATION_RATE_LIMIT,
  PUSH_NOTIFICATION_CONFIG,
  DB_QUERY_TIMEOUT
};
