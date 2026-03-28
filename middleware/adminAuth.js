import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import { verifyJWEToken } from "../utils/jweToken.js";

const verifyAdminToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.warn("🔐 Admin auth failed: No token provided");
    return res
      .status(401)
      .json({ success: false, message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    // Try to verify as JWE token first (new format)
    let decoded;
    try {
      decoded = await verifyJWEToken(token);
      console.log(
        "✅ JWE token verified successfully for admin ID:",
        decoded.id
      );
    } catch (jweError) {
      console.warn(
        "⚠️  JWE verification failed, trying JWT fallback:",
        jweError.message
      );
      // If JWE verification fails, try as regular JWT (backward compatibility)
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log(
          "✅ JWT token verified successfully for admin ID:",
          decoded.id
        );
      } catch (e) {
        console.error("❌ Both JWE and JWT verification failed");
        throw jweError; // Throw the original JWE error
      }
    }

    // Check if token has admin role (for newer tokens)
    if (decoded.role && decoded.role !== "admin") {
      console.warn(
        "🔐 Admin auth failed: Token role is not admin, got:",
        decoded.role
      );
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin privileges required.",
      });
    }

    // For environment-based admin (ID 1), skip database lookup
    if (decoded.id === 1) {
      const envAdminEmail = process.env.ADMIN_EMAIL || "nexkirana@kirana.com";
      if (decoded.email === envAdminEmail || decoded.role === "admin") {
        console.log("✅ Admin auth successful for environment admin ID 1");
        req.admin = decoded; // attach admin info from token
        return next();
      }
    }

    // For other admins, verify that the token belongs to an admin in database
    try {
      const [adminRows] = await pool.query(
        "SELECT id, email FROM admins WHERE id = ?",
        [decoded.id]
      );

      if (adminRows.length === 0) {
        console.warn(
          "🔐 Admin auth failed: Admin ID not found in database:",
          decoded.id
        );
        return res.status(403).json({
          success: false,
          message: "Admin not found",
        });
      }

      console.log(
        "✅ Admin auth successful for database admin ID:",
        decoded.id
      );
      req.admin = decoded; // attach admin info from token
      next();
    } catch (dbError) {
      console.error(
        "❌ Database error during admin verification:",
        dbError.message
      );
      // If database lookup fails, still allow ID 1 with admin role
      if (decoded.id === 1 && decoded.role === "admin") {
        console.log("✅ Admin auth successful (DB fallback) for admin ID 1");
        req.admin = decoded;
        return next();
      }
      throw dbError;
    }
  } catch (err) {
    console.error("❌ Admin auth error:", {
      message: err.message,
      name: err.name,
      code: err.code,
    });

    if (err.message === "TOKEN_EXPIRED" || err.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired. Please login again.",
      });
    }
    if (err.message === "TOKEN_REVOKED") {
      return res.status(401).json({
        success: false,
        message: "Token has been revoked. Please login again.",
      });
    }
    return res.status(403).json({
      success: false,
      message: "Invalid token",
    });
  }
};

export default verifyAdminToken;
