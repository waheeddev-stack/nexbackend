import { EncryptJWT, jwtDecrypt } from "jose";
import { getConfig } from "../config/environment.js";

const config = getConfig();

// Convert string secret to Uint8Array for JWE
const getJWESecret = () => {
  const secret = config.JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is required for JWE operations");
  }
  return new TextEncoder().encode(secret.padEnd(32, "0").slice(0, 32));
};

// Token blacklist (in production, use Redis or database)
const tokenBlacklist = new Set();

/**
 * Create an encrypted JWT token (JWE)
 * @param {Object} payload - Token payload
 * @param {string} expiresIn - Token expiration (e.g., '7d', '1h')
 * @returns {Promise<string>} Encrypted JWT token
 */
export const createJWEToken = async (payload, expiresIn = "7d") => {
  try {
    const secret = getJWESecret();
    const now = Math.floor(Date.now() / 1000);

    // Calculate expiration time
    let expirationTime;
    if (expiresIn.endsWith("d")) {
      const days = parseInt(expiresIn.slice(0, -1));
      expirationTime = now + days * 24 * 60 * 60;
    } else if (expiresIn.endsWith("h")) {
      const hours = parseInt(expiresIn.slice(0, -1));
      expirationTime = now + hours * 60 * 60;
    } else if (expiresIn.endsWith("m")) {
      const minutes = parseInt(expiresIn.slice(0, -1));
      expirationTime = now + minutes * 60;
    } else {
      // Default to 7 days if format not recognized
      expirationTime = now + 7 * 24 * 60 * 60;
    }

    const jwt = await new EncryptJWT({
      ...payload,
      iat: now,
      exp: expirationTime,
      jti: generateTokenId(), // Unique token ID for tracking
    })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setIssuedAt()
      .setExpirationTime(expirationTime)
      .encrypt(secret);

    return jwt;
  } catch (error) {
    console.error("JWE token creation error:", error);
    throw new Error("Failed to create encrypted token");
  }
};

/**
 * Verify and decrypt JWE token
 * @param {string} token - Encrypted JWT token
 * @returns {Promise<Object>} Decrypted token payload
 */
export const verifyJWEToken = async (token) => {
  try {
    if (!token || typeof token !== "string") {
      console.error("JWE verification failed: Invalid token format", {
        hasToken: !!token,
        type: typeof token,
      });
      throw new Error("Invalid token format");
    }

    // Check token structure
    const parts = token.split(".");
    if (parts.length !== 5) {
      console.error("JWE verification failed: Invalid JWE structure", {
        parts: parts.length,
        expected: 5,
      });
      throw new Error("MALFORMED_TOKEN");
    }

    // Check if token is blacklisted
    if (isTokenBlacklisted(token)) {
      console.warn("JWE verification failed: Token is blacklisted");
      throw new Error("TOKEN_REVOKED");
    }

    const secret = getJWESecret();
    const { payload } = await jwtDecrypt(token, secret);

    // Check if token is expired
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      const expiredAt = new Date(payload.exp * 1000).toISOString();
      console.warn("JWE verification failed: Token expired", {
        expiredAt,
        userId: payload.id,
      });
      throw new Error("TOKEN_EXPIRED");
    }

    // Validate required claims
    if (!payload.id && payload.id !== 0) {
      console.error("JWE verification failed: Missing user ID in payload");
      throw new Error("Invalid token: missing user ID");
    }

    return payload;
  } catch (error) {
    if (error.message === "TOKEN_EXPIRED") {
      throw new Error("TOKEN_EXPIRED");
    } else if (error.message === "TOKEN_REVOKED") {
      throw new Error("TOKEN_REVOKED");
    } else if (error.message === "MALFORMED_TOKEN") {
      throw new Error("MALFORMED_TOKEN");
    } else if (error.code === "ERR_JWE_DECRYPTION_FAILED") {
      console.error("JWE decryption failed - possible secret mismatch", {
        errorCode: error.code,
        errorMessage: error.message,
      });
      throw new Error("MALFORMED_TOKEN");
    } else {
      console.error("JWE token verification error:", {
        errorMessage: error.message,
        errorCode: error.code,
        errorName: error.name,
      });
      throw new Error("INVALID_TOKEN");
    }
  }
};

/**
 * Generate a unique token ID
 * @returns {string} Unique token identifier
 */
const generateTokenId = () => {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
};

/**
 * Add token to blacklist
 * @param {string} token - Token to blacklist
 */
export const blacklistToken = (token) => {
  tokenBlacklist.add(token);
};

/**
 * Check if token is blacklisted
 * @param {string} token - Token to check
 * @returns {boolean} True if blacklisted
 */
const isTokenBlacklisted = (token) => {
  return tokenBlacklist.has(token);
};

/**
 * Refresh token if it's close to expiration
 * @param {Object} payload - Current token payload
 * @returns {Promise<string|null>} New token if refresh needed, null otherwise
 */
export const refreshTokenIfNeeded = async (payload) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = payload.exp - now;

    // Refresh if token expires within 24 hours
    if (timeUntilExpiry < 24 * 60 * 60 && timeUntilExpiry > 0) {
      const newPayload = {
        id: payload.id,
        role: payload.role,
        // Add any other necessary claims
      };

      return await createJWEToken(newPayload, "7d");
    }

    return null;
  } catch (error) {
    console.error("Token refresh error:", error);
    return null;
  }
};

/**
 * Extract token from Authorization header
 * @param {string} authHeader - Authorization header value
 * @returns {string|null} Extracted token or null
 */
export const extractTokenFromHeader = (authHeader) => {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.split(" ")[1];
};

/**
 * Check if token is close to expiration
 * @param {Object} payload - Token payload
 * @param {number} thresholdHours - Hours before expiration to consider "close"
 * @returns {boolean} True if close to expiration
 */
export const isTokenCloseToExpiration = (payload, thresholdHours = 24) => {
  const now = Math.floor(Date.now() / 1000);
  const timeUntilExpiry = payload.exp - now;
  return timeUntilExpiry < thresholdHours * 60 * 60 && timeUntilExpiry > 0;
};
