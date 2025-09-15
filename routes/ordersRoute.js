import express from "express";
import pool from "../config/db.js";
import verifyToken from "../middleware/auth.js";

const ordersRouter = express.Router();

/**
Create new order (Customer)
 */

function calculateCredits(amount) {
  if (amount >= 100 && amount <= 300) return 10;
  if (amount > 300 && amount <= 500) return 25;
  if (amount > 500) return 50;
  return 0;
}

ordersRouter.post("/addorders", verifyToken, async (req, res) => {
  try {
    const { items } = req.body;
    const user_id = req.user.id;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "No items provided" });
    }

    // ✅ Calculate total
    const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

    // ✅ Calculate earned credits
    const earnedCredits = calculateCredits(total);

    // ✅ Insert order (save earned credits too)
    const [orderResult] = await pool.query(
      "INSERT INTO orders (user_id, total_amount, status, credits_earned) VALUES (?, ?, ?, ?)",
      [user_id, total, "Pending", earnedCredits]
    );

    const orderId = orderResult.insertId;

    // ✅ Insert order items
    for (let item of items) {
      await pool.query(
        "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)",
        [orderId, item.product_id, item.quantity, item.price]
      );
    }

    // ✅ Update user's store credits balance
    if (earnedCredits > 0) {
      await pool.query(
        "UPDATE users SET store_credits = store_credits + ? WHERE id = ?",
        [earnedCredits, user_id]
      );
    }

    // ✅ Fetch full order details
    const [orderDetails] = await pool.query(
      `SELECT 
          o.id AS orderId, 
          o.total_amount, 
          o.status, 
          o.credits_earned,
          o.created_at,
          u.id AS customer_id, 
          u.name AS customer_name, 
          u.email AS customer_email,
          u.phone AS customer_phone,
          u.address AS delivery_address,
          oi.product_id, 
          p.name AS product_name, 
          p.image AS product_image,
          oi.quantity, 
          oi.price
       FROM orders o
       JOIN users u ON o.user_id = u.id
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       WHERE o.id = ?`,
      [orderId]
    );

    // ✅ Group items into a single order object
    const orderPayload = {
      orderId,
      customer: {
        id: orderDetails[0].customer_id,
        name: orderDetails[0].customer_name,
        email: orderDetails[0].customer_email,
        phone: orderDetails[0].customer_phone,
        address: orderDetails[0].delivery_address,
      },
      total: orderDetails[0].total_amount,
      credits_earned: earnedCredits,
      credits_value: earnedCredits * 0.5, // ✅ 1 credit = 0.5 INR
      status: orderDetails[0].status,
      created_at: orderDetails[0].created_at,
      items: orderDetails.map((row) => ({
        product_id: row.product_id,
        product_name: row.product_name,
        product_image: row.product_image,
        quantity: row.quantity,
        price: row.price,
      })),
    };

    // ✅ Emit live update
    if (req.io) {
      // To shopkeepers (all)
      req.io.emit("newOrder", orderPayload);

      // To the specific customer
      req.io.to(`customer_${user_id}`).emit("newOrder", orderPayload);
    }

    res.status(201).json({
      success: true,
      message: "Order created & credits awarded",
      order: orderPayload,
    });
  } catch (err) {
    console.error("Error creating order:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * Update order status (Shopkeeper role in future)
 */

ordersRouter.patch("/:id/status", verifyToken, async (req, res) => {
  try {
    const { status } = req.body;
    const orderId = Number(req.params.id);

    // Validate order ID
    if (!orderId || isNaN(orderId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid order ID" });
    }

    // Validate status
    const validStatuses = ["Pending", "Processing", "Delivered", "Cancelled"];
    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    }

    // Update status in DB
    const [result] = await pool.query(
      "UPDATE orders SET status = ? WHERE id = ?",
      [status, orderId]
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    // Emit status update to all connected clients
    if (req.io) {
      req.io.emit("orderStatusUpdate", { orderId, status });

      // Optional: emit updated dashboard stats
      const [[{ totalOrders }]] = await pool.query(
        "SELECT COUNT(*) AS totalOrders FROM orders"
      );
      const [[{ totalRevenue }]] = await pool.query(
        "SELECT SUM(total_amount) AS totalRevenue FROM orders"
      );
      const [[{ totalUsers }]] = await pool.query(
        "SELECT COUNT(*) AS totalUsers FROM users"
      );
      const [ordersByStatus] = await pool.query(
        "SELECT status, COUNT(*) AS count FROM orders GROUP BY status"
      );

      req.io.emit("dashboardStatsUpdate", {
        totalOrders,
        totalRevenue,
        totalUsers,
        ordersByStatus,
      });
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

// ordersRouter.get("/myorders", verifyToken, async (req, res) => {
//   try {
//     const userId = req.user.id; // from verifyToken middleware

//     const [orders] = await pool.query(
//       `SELECT o.id, o.status, o.total_amount, o.created_at,
//               JSON_ARRAYAGG(
//                 JSON_OBJECT(
//                   'id', oi.product_id,
//                   'quantity', oi.quantity,
//                   'price', oi.price,
//                   'name', p.name,
//                   'image', p.image
//                 )
//               ) AS items
//        FROM orders o
//        JOIN order_items oi ON o.id = oi.order_id
//        JOIN products p ON oi.product_id = p.id
//        WHERE o.user_id = ?
//        GROUP BY o.id
//        ORDER BY o.created_at DESC`,
//       [userId]
//     );

//     res.json({ success: true, orders });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false, message: "Failed to fetch orders" });
//   }
// });

ordersRouter.get("/myorders", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [orders] = await pool.query(
      `SELECT o.id, o.status, o.total_amount, o.created_at, o.credits_earned,
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

    // Optional: calculate credits value (e.g., 1 credit = 0.5 INR)
    const ordersWithCreditsValue = orders.map((o) => ({
      ...o,
      credits_value: o.credits_earned * 0.5,
    }));

    res.json({ success: true, orders: ordersWithCreditsValue });
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

ordersRouter.get("/live", verifyToken, async (req, res) => {
  try {
const [orders] = await pool.query(
  `SELECT 
      o.id AS order_id, 
      o.status, 
      o.total_amount, 
      o.created_at,
      COALESCE(
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'id', oi.product_id,
            'name', p.name,
            'quantity', oi.quantity,
            'price', oi.price,
            'image', p.image
          )
        ), JSON_ARRAY()
      ) AS items,
      ANY_VALUE(u.name) AS customer_name, 
      ANY_VALUE(u.address) AS delivery_address,
      ANY_VALUE(u.phone) AS customer_phone
   FROM orders o
   JOIN order_items oi ON o.id = oi.order_id
   JOIN products p ON oi.product_id = p.id
   JOIN users u ON o.user_id = u.id
   WHERE o.status IN ('Pending', 'Processing', 'Delivered', 'Cancelled')
   GROUP BY o.id
   ORDER BY o.created_at ASC`
);

    res.json({ success: true, orders });
  } catch (err) {
    console.error("❌ Error fetching live orders:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * Get all orders for a specific customer
 */
// ordersRouter.get("/customer/:id", verifyToken, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const [orders] = await pool.query(
//       `SELECT o.*, u.name AS customer_name
//        FROM orders o
//        JOIN users u ON o.user_id = u.id
//        WHERE o.user_id = ?
//        ORDER BY o.created_at DESC`,
//       [id]
//     );
//     res.json({ success: true, orders });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Server error" });
//   }
// });

export default ordersRouter;
