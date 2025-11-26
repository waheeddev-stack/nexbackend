import jwt from "jsonwebtoken";
import fetch from "node-fetch";

// Middleware to verify a Clerk token at a basic level and fetch user info from Clerk
// Notes:
// - This implementation decodes the incoming token to get the Clerk user id (sub claim),
//   then calls the Clerk Admin API to fetch user details using a server API key.
// - Set `CLERK_API_KEY` in your .env with a server key from Clerk.
// - This approach does a server-side verification by fetching the user; for strongest
//   security prefer Clerk's official SDK / middleware.

const clerkAuth = async (req, res, next) => {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.decode(token);
    const userId = payload?.sub || payload?.user_id || payload?.uid;
    if (!userId) {
      return res.status(403).json({ success: false, message: "Invalid Clerk token (no user id)" });
    }

    const clerkKey = process.env.CLERK_API_KEY;
    if (!clerkKey) {
      return res.status(500).json({ success: false, message: "Server not configured: CLERK_API_KEY missing" });
    }

    // Fetch user info from Clerk Admin API
    const resp = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: {
        Authorization: `Bearer ${clerkKey}`,
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      return res.status(403).json({ success: false, message: "Unable to verify Clerk user" });
    }

    const user = await resp.json();

    // Attach a compact clerk object on the request for downstream routes
    req.clerk = {
      userId: user.id,
      email: user.email_addresses && user.email_addresses[0] && user.email_addresses[0].email_address,
      firstName: user.first_name || null,
      lastName: user.last_name || null,
    };

    next();
  } catch (err) {
    console.error("clerkAuth error:", err.message);
    return res.status(403).json({ success: false, message: "Invalid or expired token" });
  }
};

export default clerkAuth;
