import jwt from "jsonwebtoken";
import { getConfig } from "../config/environment.js";

const config = getConfig();

// Token blacklist (in production, use Redis or database)
const tokenBlacklist = new Set();

// Add token to blacklist
export const blacklistToken = (token) => {
  tokenBlacklist.add(token);
};

// Check if token is blacklisted
const isTokenBlacklisted = (token) => {
  return tokenBlacklist.has(token);
};

// Validate token structure and claims
const validateTokenStructure = (decoded) => {
  // Check required claims - allow both string and number IDs
  if (!decoded.id && decoded.id !== 0) {
    throw new Error('Invalid token: missing user ID');
  }

  // Convert string ID to number if needed
  const userId = typeof decoded.id === 'string' ? parseInt(decoded.id) : decoded.id;
  if (isNaN(userId)) {
    throw new Error('Invalid token: invalid user ID format');
  }

  // Check token age (optional additional security)
  if (decoded.iat) {
    const tokenAge = Date.now() / 1000 - decoded.iat;
    const maxAge = 7 * 24 * 60 * 60; // 7 days in seconds
    
    if (tokenAge > maxAge) {
      throw new Error('Token too old');
    }
  }

  return true;
};

const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];

    // Check for authorization header
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ 
        success: false, 
        message: "Access denied. No token provided.",
        code: "NO_TOKEN"
      });
    }

    const token = authHeader.split(" ")[1];

    // Check if token is properly formatted
    if (!token || token.length < 10) {
      return res.status(401).json({ 
        success: false, 
        message: "Invalid token format",
        code: "INVALID_FORMAT"
      });
    }

    // Check if token is blacklisted
    if (isTokenBlacklisted(token)) {
      return res.status(401).json({ 
        success: false, 
        message: "Token has been revoked",
        code: "TOKEN_REVOKED"
      });
    }

    // Verify token with enhanced error handling
    jwt.verify(token, config.JWT_SECRET, (err, decoded) => {
      if (err) {
        let message = "Invalid token";
        let code = "INVALID_TOKEN";

        if (err.name === 'TokenExpiredError') {
          message = "Token has expired";
          code = "TOKEN_EXPIRED";
        } else if (err.name === 'JsonWebTokenError') {
          message = "Malformed token";
          code = "MALFORMED_TOKEN";
        } else if (err.name === 'NotBeforeError') {
          message = "Token not active yet";
          code = "TOKEN_NOT_ACTIVE";
        }

        return res.status(403).json({ 
          success: false, 
          message,
          code
        });
      }

      try {
        // Validate token structure and claims
        validateTokenStructure(decoded);

        // Attach user info from token
        const userId = typeof decoded.id === 'string' ? parseInt(decoded.id) : decoded.id;
        req.user = {
          id: userId,
          iat: decoded.iat,
          exp: decoded.exp
        };

        // Store original token for potential blacklisting
        req.token = token;

        next();
      } catch (validationError) {
        return res.status(403).json({ 
          success: false, 
          message: validationError.message,
          code: "INVALID_TOKEN_CLAIMS"
        });
      }
    });

  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(500).json({ 
      success: false, 
      message: "Authentication service error",
      code: "AUTH_SERVICE_ERROR"
    });
  }
};

// Optional middleware for role-based access
export const requireRole = (roles) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ 
          success: false, 
          message: "Authentication required" 
        });
      }

      // In a full implementation, you would fetch user role from database
      // For now, we'll assume role is in token or can be determined from user ID
      
      next();
    } catch (error) {
      return res.status(500).json({ 
        success: false, 
        message: "Authorization service error" 
      });
    }
  };
};

export default verifyToken;
