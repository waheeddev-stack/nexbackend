import jwt from "jsonwebtoken";

// Verifies JWT from Authorization header or cookie and normalizes req.user
const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    let token = null;

    if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Normalize common payload shapes: { sub } or { id }
    const normalized = {};
    if (decoded && typeof decoded === "object") {
      normalized.id = decoded.sub ?? decoded.id ?? decoded.userId ?? decoded.uid ?? null;
      normalized.raw = decoded;
    } else {
      normalized.id = decoded;
      normalized.raw = decoded;
    }

    req.user = normalized;
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};

export default verifyToken;
