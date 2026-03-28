import {
  verifyJWEToken,
  extractTokenFromHeader,
  refreshTokenIfNeeded,
  blacklistToken as blacklistJWEToken,
} from "../utils/jweToken.js";

// Re-export blacklist function for backward compatibility
export const blacklistToken = blacklistJWEToken;

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];

    // Check for authorization header
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
        code: "NO_TOKEN",
        action: "REDIRECT_TO_LOGIN",
      });
    }

    const token = extractTokenFromHeader(authHeader);

    // Check if token is properly formatted
    if (!token || token.length < 10) {
      return res.status(401).json({
        success: false,
        message: "Invalid token format",
        code: "INVALID_FORMAT",
        action: "REDIRECT_TO_LOGIN",
      });
    }

    try {
      // Verify and decrypt JWE token
      const payload = await verifyJWEToken(token);

      // Convert string ID to number if needed
      const userId =
        typeof payload.id === "string" ? parseInt(payload.id) : payload.id;
      if (isNaN(userId)) {
        return res.status(403).json({
          success: false,
          message: "Invalid user ID in token",
          code: "INVALID_TOKEN_CLAIMS",
          action: "REDIRECT_TO_LOGIN",
        });
      }

      // Attach user info from token
      req.user = {
        id: userId,
        role: payload.role,
        iat: payload.iat,
        exp: payload.exp,
        jti: payload.jti,
      };

      // Store original token for potential blacklisting
      req.token = token;

      // Check if token needs refresh and add to response headers
      const newToken = await refreshTokenIfNeeded(payload);
      if (newToken) {
        res.set("X-New-Token", newToken);
        res.set("X-Token-Refresh", "true");
        res.set(
          "X-Token-Expires-In",
          Math.floor((payload.exp - Date.now() / 1000) / 3600) + "h"
        );
      }

      next();
    } catch (verificationError) {
      let message = "Invalid token";
      let code = "INVALID_TOKEN";

      if (verificationError.message === "TOKEN_EXPIRED") {
        message = "Your session has expired. Please login again.";
        code = "TOKEN_EXPIRED";
      } else if (verificationError.message === "TOKEN_REVOKED") {
        message = "Token has been revoked. Please login again.";
        code = "TOKEN_REVOKED";
      } else if (verificationError.message === "MALFORMED_TOKEN") {
        message = "Malformed token. Please login again.";
        code = "MALFORMED_TOKEN";
      }

      return res.status(401).json({
        success: false,
        message,
        code,
        action: "REDIRECT_TO_LOGIN",
      });
    }
  } catch (error) {
    console.error("Token verification error:", error);
    return res.status(500).json({
      success: false,
      message: "Authentication service error",
      code: "AUTH_SERVICE_ERROR",
      action: "RETRY_OR_LOGIN",
    });
  }
};

// Optional middleware for role-based access
export const requireRole = () => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      // In a full implementation, you would fetch user role from database
      // For now, we'll assume role is in token or can be determined from user ID

      next();
    } catch (e) {
      return res.status(500).json({
        success: false,
        message: "Authorization service error",
      });
    }
  };
};

export default verifyToken;
