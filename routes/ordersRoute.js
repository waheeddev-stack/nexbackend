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

    // 🔥 Emit event to shopkeepers room
    if (req.io) {
      req.io.emit("newOrder", { orderId, user_id, total });
    }

    res.status(201).json({ success: true, message: "Order created", orderId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * Update order status (Shopkeeper role in future)
 */
ordersRouter.patch("/:id/status", verifyToken, async (req, res) => {
  try {
    const { status } = req.body;
    const { id } = req.params;

    const validStatuses = ["Pending", "Processing", "Delivered", "Cancelled"];
    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    }

    const [result] = await pool.query(
      "UPDATE orders SET status = ? WHERE id = ?",
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    if (req.io) {
      req.io.emit("orderStatusUpdate", { orderId: id, status });
    }

    res.json({
      success: true,
      message: `Order status updated to ${status}`,
      status,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✅ Get all orders of the logged-in user
ordersRouter.get("/myorders", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id; // from verifyToken middleware

    const [orders] = await pool.query(
      `SELECT o.id, o.status, o.total_amount, o.created_at,
              JSON_ARRAYAGG(
                JSON_OBJECT(
                  'id', oi.product_id,
                  'quantity', oi.quantity,
                  'price', oi.price,
                  'name', p.name,
                  'image', p.image
                )
              ) AS items
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       WHERE o.user_id = ?
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [userId]
    );

    res.json({ success: true, orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to fetch orders" });
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

/**
 * Get all live orders for shopkeepers
 * Returns orders with status "Pending" or "Processing"
 */
ordersRouter.get("/live", verifyToken, async (req, res) => {
  try {
    // Optional: check if the user has shopkeeper role
    // if (req.user.role !== "shopkeeper") return res.status(403).json({ message: "Forbidden" });

    const [orders] = await pool.query(
      `SELECT o.id AS order_id, o.status, o.total_amount, o.created_at,
              JSON_ARRAYAGG(
                JSON_OBJECT(
                  'id', oi.product_id,
                  'name', p.name,
                  'quantity', oi.quantity,
                  'price', oi.price,
                  'image', p.image
                )
              ) AS items,
              u.name AS customer_name, u.address AS delivery_address
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       JOIN users u ON o.user_id = u.id
       WHERE o.status IN ('Pending', 'Processing')
       GROUP BY o.id
       ORDER BY o.created_at ASC`
    );

    res.json({ success: true, orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

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
