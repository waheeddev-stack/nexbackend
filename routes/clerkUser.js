import express from "express";
import pool from "../config/db.js";
import clerkAuth from "../middleware/clerkAuth.js";

const router = express.Router();

// POST /api/clerk/sync
// Upsert user in local `users` table based on Clerk user id
router.post("/sync", clerkAuth, async (req, res) => {
  const clerk = req.clerk;
  if (!clerk || !clerk.userId) {
    return res.status(400).json({ success: false, message: "Missing clerk user info" });
  }

  const name = [clerk.firstName, clerk.lastName].filter(Boolean).join(" ") || null;
  const email = clerk.email || null;

  try {
    // Ensure users table has a clerk_id column (see migration SQL in scripts/migrations)
    const [rows] = await pool.query("SELECT id FROM users WHERE clerk_id = ?", [clerk.userId]);
    if (rows.length === 0) {
      const [result] = await pool.query(
        "INSERT INTO users (clerk_id, name, email, created_at) VALUES (?, ?, ?, NOW())",
        [clerk.userId, name, email]
      );
      return res.status(201).json({ success: true, createdId: result.insertId });
    } else {
      const id = rows[0].id;
      await pool.query("UPDATE users SET name = ?, email = ? WHERE id = ?", [name, email, id]);
      return res.json({ success: true, updatedId: id });
    }
  } catch (err) {
    console.error("clerk sync error:", err.message);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

export default router;
