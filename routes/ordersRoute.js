import express from "express";
import pool from "../config/db.js";
import { verifyToken } from "../middleware/auth.js";

const ordersRouter = express.Router();

/**
Create new order (Customer)
 */
ordersRouter.post("/addorders", verifyToken, async (req, res) => {
  try {
    const { items } = req.body;
    const user_id = req.user.id; // from token

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "No items provided" });
    }

    // Calculate total
    const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

    // Insert order
    const [orderResult] = await pool.query(
      "INSERT INTO orders (user_id, total_amount, status) VALUES (?, ?, ?)",
      [user_id, total, "Pending"] // Default ENUM
    );

    const orderId = orderResult.insertId;

    // Insert order items
    for (let item of items) {
      await pool.query(
        "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)",
        [orderId, item.product_id, item.quantity, item.price]
      );
    }

    res.status(201).json({ success: true, message: "Order created", orderId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * Update order status (Admin/Shopkeeper role in future)
 */
ordersRouter.put("/:id/status", verifyToken, async (req, res) => {
  try {
    const { status } = req.body;
    const { id } = req.params;

    // Match ENUM values in DB
    const validStatuses = ["Pending", "Processing", "Delivered", "Cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    await pool.query("UPDATE orders SET status = ? WHERE id = ?", [status, id]);

    res.json({ success: true, message: `Order status updated to ${status}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * Get all orders (Admin / Dashboard)
 */
ordersRouter.get("/", verifyToken, async (req, res) => {
  try {
    const [orders] = await pool.query(
      `SELECT o.*, u.name AS customer_name
       FROM orders o
       JOIN users u ON o.user_id = u.id
       ORDER BY o.created_at DESC`
    );
    res.json({ success: true, orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

//  add Shopkeepers orders fetching

/**
 * Get all orders for a specific customer
 */
ordersRouter.get("/customer/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const [orders] = await pool.query(
      `SELECT o.*, u.name AS customer_name
       FROM orders o
       JOIN users u ON o.user_id = u.id
       WHERE o.user_id = ?
       ORDER BY o.created_at DESC`,
      [id]
    );
    res.json({ success: true, orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

export default ordersRouter;
