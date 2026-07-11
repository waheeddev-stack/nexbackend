import jwt from "jsonwebtoken";

// Minimal auth middleware for navigation tracking.
// Accepts Authorization: Bearer <token> and attaches req.user.
// If missing/invalid, returns 401.
export default function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (!token) {
      return res.status(401).json({ success: false, message: "Missing token" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ success: false, message: "Server misconfigured: JWT_SECRET not set" });
    }

    const payload = jwt.verify(token, secret);

    // Expected shape depends on existing backend; keep generic.
    req.user = {
      id: payload.id ?? payload.user_id ?? payload.sub,
      role: payload.role ?? payload.user_role ?? "shopkeeper",
    };

    return next();
  } catch (e) {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
}

