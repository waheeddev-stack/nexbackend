import express from "express";
import pool from "../config/db.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

/**
 * Create new order (Customer)
 */
router.post("/", verifyToken, async (req, res) => {
  try {
    const { shopkeeper_id, items } = req.body; // items = [{product_id, quantity, price}]
    const customer_id = req.user.id;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "No items provided" });
    }

    // Calculate total
    const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

    // Insert order
    const [orderResult] = await pool.query(
      "INSERT INTO orders (customer_id, shopkeeper_id, total_amount) VALUES (?, ?, ?)",
      [customer_id, shopkeeper_id, total]
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
 * Update order status (Shopkeeper only)
 */
router.put("/:id/status", verifyToken, async (req, res) => {
  try {
    const { status } = req.body;
    const { id } = req.params;

    if (!["pending", "confirmed", "shipped", "delivered", "cancelled"].includes(status)) {
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
 * Get all orders for shopkeeper
 */
router.get("/shopkeeper/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const [orders] = await pool.query(
      `SELECT o.*, c.name AS customer_name
       FROM orders o
       JOIN customers c ON o.customer_id = c.id
       WHERE o.shopkeeper_id = ?
       ORDER BY o.created_at DESC`,
      [id]
    );
    res.json({ success: true, orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * Get all orders for customer
 */
router.get("/customer/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const [orders] = await pool.query(
      `SELECT o.*, s.shop_name
       FROM orders o
       JOIN shopkeepers s ON o.shopkeeper_id = s.id
       WHERE o.customer_id = ?
       ORDER BY o.created_at DESC`,
      [id]
    );
    res.json({ success: true, orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
