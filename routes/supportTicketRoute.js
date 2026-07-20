import express from "express";
import pool from "../config/db.js";
import verifyToken from "../middleware/auth.js";

const ticketRouter = express.Router();

// Create a support ticket (shopkeeper)
// POST /api/shopkeeper/support-ticket
ticketRouter.post("/support-ticket", verifyToken, async (req, res) => {
  try {
    const { shopkeeper_id, full_name, email, subject, category, message } = req.body;

    if (!shopkeeper_id || !full_name || !email || !subject || !category || !message) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    const [result] = await pool.execute(
      `INSERT INTO support_tickets (shopkeeper_id, full_name, email, subject, category, message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [shopkeeper_id, full_name, email, subject, category, message]
    );

    res.status(201).json({
      success: true,
      message: "Support ticket created successfully",
      ticket: { id: result.insertId },
    });
  } catch (err) {
    console.error("Create support ticket error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get all tickets for the logged-in shopkeeper
// GET /api/shopkeeper/support-tickets
ticketRouter.get("/support-tickets", verifyToken, async (req, res) => {
  try {
    const [tickets] = await pool.execute(
      "SELECT * FROM support_tickets WHERE shopkeeper_id = ? ORDER BY created_at DESC",
      [req.user.id]
    );

    res.json({ success: true, data: tickets });
  } catch (err) {
    console.error("Get shopkeeper tickets error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Close ticket (shopkeeper)
// PUT /api/shopkeeper/support-ticket/:ticketId
ticketRouter.put("/support-ticket/:ticketId", verifyToken, async (req, res) => {
  try {
    const { status } = req.body;
    const { ticketId } = req.params;

    const [tickets] = await pool.execute("SELECT * FROM support_tickets WHERE id = ?", [ticketId]);

    if (tickets.length === 0) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    if (tickets[0].shopkeeper_id !== req.user.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    if (status !== "closed") {
      return res.status(403).json({ success: false, message: "Shopkeeper can only close tickets" });
    }

    await pool.execute("UPDATE support_tickets SET status = 'closed' WHERE id = ?", [ticketId]);

    const [updated] = await pool.execute("SELECT * FROM support_tickets WHERE id = ?", [ticketId]);

    res.json({ success: true, message: "Ticket closed", data: updated[0] });
  } catch (err) {
    console.error("Update ticket error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default ticketRouter;
