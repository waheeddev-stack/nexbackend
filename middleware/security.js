import { getConfig } from "../config/environment.js";

const config = getConfig();

// Enhanced security headers middleware
export const securityHeaders = (req, res, next) => {
  // Prevent XSS attacks
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");

  // Referrer policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Content Security Policy
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https:; " +
      "connect-src 'self' https:; " +
      "font-src 'self' https:; " +
      "object-src 'none'; " +
      "media-src 'self'; " +
      "frame-src 'none';"
  );

  // HSTS (only in production with HTTPS)
  if (config.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }

  // Remove server information
  res.removeHeader("X-Powered-By");
  res.removeHeader("Server");

  next();
};

// Request sanitization middleware
export const sanitizeRequest = (req, res, next) => {
  // Sanitize query parameters
  if (req.query) {
    for (const key in req.query) {
      if (typeof req.query[key] === "string") {
        req.query[key] = req.query[key].trim().substring(0, 1000);
      }
    }
  }

  // Sanitize URL parameters
  if (req.params) {
    for (const key in req.params) {
      if (typeof req.params[key] === "string") {
        req.params[key] = req.params[key].trim().substring(0, 100);
      }
    }
  }

  next();
};

// Request logging middleware (production-safe)
export const requestLogger = (req, res, next) => {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const url = req.originalUrl;
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get("User-Agent") || "Unknown";

  // Log basic request info (safe for production)
  console.log(`${timestamp} - ${method} ${url} - IP: ${ip}`);

  // In development, log more details
  if (config.NODE_ENV !== "production") {
    console.log(`Headers:`, {
      "content-type": req.get("content-type"),
      authorization: req.get("authorization") ? "Bearer [REDACTED]" : "None",
      "user-agent": userAgent,
    });

    if (req.query && Object.keys(req.query).length > 0) {
      console.log(`Query:`, req.query);
    }

    if (req.body && Object.keys(req.body).length > 0) {
      // Log body but redact sensitive fields
      const safeBody = { ...req.body };
      const sensitiveFields = ["password", "token", "secret", "key"];

      sensitiveFields.forEach((field) => {
        if (safeBody[field]) {
          safeBody[field] = "[REDACTED]";
        }
      });

      console.log(`Body:`, safeBody);
    }
  }

  next();
};

// Error handling middleware
export const errorHandler = (error, req, res, _next) => {
  console.error("Error occurred:", {
    message: error.message,
    stack: config.NODE_ENV !== "production" ? error.stack : undefined,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    timestamp: new Date().toISOString(),
  });

  // Default error response
  let statusCode = 500;
  let message = "Internal server error";
  let code = "INTERNAL_ERROR";

  // Handle specific error types
  if (error.name === "ValidationError") {
    statusCode = 400;
    message = error.message;
    code = "VALIDATION_ERROR";
  } else if (error.name === "UnauthorizedError") {
    statusCode = 401;
    message = "Unauthorized access";
    code = "UNAUTHORIZED";
  } else if (error.name === "ForbiddenError") {
    statusCode = 403;
    message = "Access forbidden";
    code = "FORBIDDEN";
  } else if (error.name === "NotFoundError") {
    statusCode = 404;
    message = "Resource not found";
    code = "NOT_FOUND";
  }

  // Send error response
  res.status(statusCode).json({
    success: false,
    message: message,
    code: code,
    timestamp: new Date().toISOString(),
    // Only include error details in development
    ...(config.NODE_ENV !== "production" && {
      error: error.message,
      stack: error.stack,
    }),
  });
};

// 404 handler
export const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    code: "ROUTE_NOT_FOUND",
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
    availableRoutes:
      config.NODE_ENV !== "production"
        ? [
            "GET /",
            "GET /health",
            "GET /api",
            "POST /api/user/signin",
            "POST /api/user/signup",
            "POST /api/shopkeeper/signin",
            "POST /api/admin/login",
          ]
        : undefined,
  });
};

// CORS configuration
export const corsConfig = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    if (config.NODE_ENV === "production") {
      const allowedOrigins = config.corsOrigins;

      // Check if origin is allowed or is an Expo app
      if (
        allowedOrigins.includes(origin) ||
        origin.startsWith("exp://") ||
        origin.startsWith("exps://")
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS policy"));
      }
    } else {
      // Allow all origins in development
      callback(null, true);
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: ["X-Total-Count", "X-New-Token", "X-Token-Refresh", "X-Token-Expires-In", "X-Order-Token-Warning", "X-Order-Message"],
  maxAge: 86400, // 24 hours
};

// Request size limiter
export const requestSizeLimiter = (req, res, next) => {
  const contentLength = parseInt(req.get("content-length") || "0");
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (contentLength > maxSize) {
    return res.status(413).json({
      success: false,
      message: "Request entity too large",
      code: "REQUEST_TOO_LARGE",
      maxSize: "10MB",
    });
  }

  next();
};

export default {
  securityHeaders,
  sanitizeRequest,
  requestLogger,
  errorHandler,
  notFoundHandler,
  corsConfig,
  requestSizeLimiter,
};
