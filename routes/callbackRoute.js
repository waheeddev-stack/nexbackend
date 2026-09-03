import express from "express";
import pool from "../config/db.js";
import verifyToken from "../middleware/auth.js";

const callbackRouter = express.Router();

// Ensure callback_requests table exists (lazy init)
let tableEnsured = false;
async function ensureCallbackTable() {
  if (tableEnsured) return;
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS callback_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        shopkeeper_id INTEGER,
        source VARCHAR(20) DEFAULT 'customer',
        name VARCHAR(255),
        phone VARCHAR(20) NOT NULL,
        email VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        called_at TIMESTAMP,
        called_by INTEGER,
        notes TEXT
      )
    `);
    // Migration: add source/shopkeeper_id columns for pre-existing tables
    const addColumnIfMissing = async (column, ddl) => {
      try {
        const [cols] = await pool.execute(`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'callback_requests' AND column_name = ?
        `, [column]);
        if (cols.length === 0) await pool.execute(ddl);
      } catch (e) {
        console.warn(`callback_requests migration (${column}) failed:`, e.message);
      }
    };
    await addColumnIfMissing("shopkeeper_id", "ALTER TABLE callback_requests ADD COLUMN shopkeeper_id INTEGER");
    await addColumnIfMissing("source", "ALTER TABLE callback_requests ADD COLUMN source VARCHAR(20) DEFAULT 'customer'");
    tableEnsured = true;
    console.log("✅ callback_requests table ready");
  } catch (err) {
    console.error("❌ Failed to ensure callback_requests table:", err.message);
  }
}
ensureCallbackTable();

// POST /api/callbacks  -> request a callback (authenticated)
// Body: { phone, email, name } — phone/email optional if derived from user profile
callbackRouter.post("/", verifyToken, async (req, res) => {
  try {
    await ensureCallbackTable();
    const userId = req.user?.id || null;
    const source = req.user?.role === "shopkeeper" ? "shopkeeper" : "customer";
    let { phone, email, name } = req.body || {};

    // Fallback: derive from users table if not supplied (customers)
    if ((!phone || !email || !name) && userId && source === "customer") {
      try {
        const [rows] = await pool.execute(
          "SELECT name, phone, email FROM users WHERE id = ?",
          [userId]
        );
        if (rows.length > 0) {
          const u = rows[0];
          if (!phone) phone = u.phone;
          if (!email) email = u.email;
          if (!name) name = u.name;
        }
      } catch (e) {
        console.warn("callback derive profile failed:", e.message);
      }
    }

    if (!phone || String(phone).trim().length < 7) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required to request a callback",
      });
    }
    if (!email || !String(email).trim()) {
      // email is encouraged but not strictly required for DB; we default to empty
      email = email || "";
    }

    phone = String(phone).trim().slice(0, 20);
    email = String(email).trim().slice(0, 255);
    name = name ? String(name).trim().slice(0, 255) : null;

    // Anti-spam: block duplicate pending request from same user/phone within 10 minutes
    if (userId) {
      const [recent] = await pool.execute(
        `SELECT id FROM callback_requests WHERE user_id = ? AND status = 'pending' AND created_at > NOW() - INTERVAL '10 minutes' LIMIT 1`,
        [userId]
      );
      if (recent.length > 0) {
        return res.status(429).json({
          success: false,
          message: "You already have a pending callback request. We will call you shortly.",
          duplicate: true,
          requestId: recent[0].id,
        });
      }
    } else {
      const [recentPhone] = await pool.execute(
        `SELECT id FROM callback_requests WHERE phone = ? AND status = 'pending' AND created_at > NOW() - INTERVAL '10 minutes' LIMIT 1`,
        [phone]
      );
      if (recentPhone.length > 0) {
        return res.status(429).json({
          success: false,
          message: "A callback request with this number is already pending. We will call you shortly.",
          duplicate: true,
          requestId: recentPhone[0].id,
        });
      }
    }

    const [result] = await pool.execute(
      `INSERT INTO callback_requests (user_id, shopkeeper_id, source, name, phone, email, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [source === "shopkeeper" ? null : userId, source === "shopkeeper" ? userId : null, source, name, phone, email]
    );

    // Emit socket to admin room if available
    try {
      const io = req.io || req.app?.get?.("io");
      if (io) {
        io.to("admin").emit("callbackRequest", {
          id: result.insertId,
          user_id: source === "shopkeeper" ? null : userId,
          shopkeeper_id: source === "shopkeeper" ? userId : null,
          source,
          name,
          phone,
          email,
          status: "pending",
          created_at: new Date().toISOString(),
        });
      }
    } catch {}

    return res.status(201).json({
      success: true,
      message: "Callback requested. You will get a callback shortly.",
      requestId: result.insertId,
      data: {
        id: result.insertId,
        user_id: source === "shopkeeper" ? null : userId,
        shopkeeper_id: source === "shopkeeper" ? userId : null,
        source,
        name,
        phone,
        email,
        status: "pending",
      },
    });
  } catch (err) {
    console.error("Create callback request error:", err);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// POST /api/callbacks/guest -> unauthenticated fallback (phone + email required)
callbackRouter.post("/guest", async (req, res) => {
  try {
    await ensureCallbackTable();
    let { phone, email, name } = req.body || {};
    if (!phone || String(phone).trim().length < 7) {
      return res.status(400).json({ success: false, message: "Phone number is required" });
    }
    phone = String(phone).trim().slice(0, 20);
    email = email ? String(email).trim().slice(0, 255) : "";
    name = name ? String(name).trim().slice(0, 255) : null;

    const [recent] = await pool.execute(
      `SELECT id FROM callback_requests WHERE phone = ? AND status = 'pending' AND created_at > NOW() - INTERVAL '10 minutes' LIMIT 1`,
      [phone]
    );
    if (recent.length > 0) {
      return res.status(429).json({
        success: false,
        message: "A callback request with this number is already pending. We will call you shortly.",
        duplicate: true,
        requestId: recent[0].id,
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO callback_requests (user_id, shopkeeper_id, source, name, phone, email, status) VALUES (NULL, NULL, 'guest', ?, ?, ?, 'pending')`,
      [name, phone, email]
    );

    try {
      const io = req.io || req.app?.get?.("io");
      if (io) io.to("admin").emit("callbackRequest", { id: result.insertId, phone, email, name, status: "pending" });
    } catch {}

    return res.status(201).json({
      success: true,
      message: "Callback requested. You will get a callback shortly.",
      requestId: result.insertId,
    });
  } catch (err) {
    console.error("Guest callback error:", err);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// GET /api/callbacks/my -> user's own requests (authenticated)
callbackRouter.get("/my", verifyToken, async (req, res) => {
  try {
    await ensureCallbackTable();
    const isShopkeeper = req.user?.role === "shopkeeper";
    const idCol = isShopkeeper ? "shopkeeper_id" : "user_id";
    const [rows] = await pool.execute(
      `SELECT id, name, phone, email, status, created_at, updated_at, called_at FROM callback_requests WHERE ${idCol} = ? ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Get my callbacks error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default callbackRouter;
export { ensureCallbackTable };
