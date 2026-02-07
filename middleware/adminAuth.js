import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import { verifyJWEToken } from "../utils/jweToken.js";

const verifyAdminToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    // Try to verify as JWE token first (new format)
    let decoded;
    try {
      decoded = await verifyJWEToken(token);
    } catch (jweError) {
      // If JWE verification fails, try as regular JWT (backward compatibility)
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (jwtError) {
        throw jweError; // Throw the original JWE error
      }
    }
    
    // Check if token has admin role (for newer tokens)
    if (decoded.role && decoded.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: "Access denied. Admin privileges required." 
      });
    }
    
    // For environment-based admin (ID 1), skip database lookup
    if (decoded.id === 1 && decoded.role === 'admin') {
      const envAdminEmail = process.env.ADMIN_EMAIL || 'nexkirana@kirana.com';
      if (decoded.email === envAdminEmail) {
        req.admin = decoded; // attach admin info from token
        return next();
      }
    }
    
    // For other admins, verify that the token belongs to an admin in database
    const [adminRows] = await pool.query(
      "SELECT id, email FROM admins WHERE id = ?",
      [decoded.id]
    );

    if (adminRows.length === 0) {
      return res.status(403).json({ 
        success: false, 
        message: "Admin not found" 
      });
    }

    req.admin = decoded; // attach admin info from token
    next();
  } catch (err) {
    if (err.message === 'TOKEN_EXPIRED' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: "Token expired. Please login again." 
      });
    }
    if (err.message === 'TOKEN_REVOKED') {
      return res.status(401).json({ 
        success: false, 
        message: "Token has been revoked. Please login again." 
      });
    }
    return res.status(403).json({ 
      success: false, 
      message: "Invalid token" 
    });
  }
};

export default verifyAdminToken;