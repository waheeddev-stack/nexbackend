import jwt from "jsonwebtoken";
import pool from "../config/db.js";

const verifyAdminToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if token has admin role (for newer tokens)
    if (decoded.role && decoded.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: "Access denied. Admin privileges required." 
      });
    }
    
    // Verify that the token belongs to an admin in database
    const [adminRows] = await pool.query(
      "SELECT id, email FROM admins WHERE id = ?",
      [decoded.id]
    );

    if (adminRows.length === 0) {
      return res.status(403).json({ 
        success: false, 
        message: "Access denied. Admin privileges required." 
      });
    }

    req.admin = decoded; // attach admin info from token
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: "Token expired. Please login again." 
      });
    }
    return res.status(403).json({ 
      success: false, 
      message: "Invalid token" 
    });
  }
};

export default verifyAdminToken;