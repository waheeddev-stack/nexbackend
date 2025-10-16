import express from "express";
import pool from "../config/db.js";
import verifyToken from "../middleware/auth.js";
import fetch from "node-fetch";

const ordersRouter = express.Router();


async function getAddressFromCoords(latitude, longitude) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`;
  const res = await fetch(url, { headers: { "User-Agent": "nexkirana" } });
  const data = await res.json();
  return data.display_name || null;
}

function calculateCredits(amount) {
  if (amount >= 100 && amount <= 300) return 10;
  if (amount > 300 && amount <= 500) return 25;
  if (amount > 500) return 50;
  return 0;
}

// Create new order (Customer) - Updated for shop_products structure
ordersRouter.post("/addorders", verifyToken, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { items, latitude, longitude } = req.body;
    const user_id = req.user.id;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "No items provided" });
    }

    if (!latitude || !longitude) {
      return res.status(400).json({ message: "Delivery location required" });
    }

    // Find nearest shopkeeper (within 2 km)
    const [nearestShop] = await pool.query(
      `SELECT id,
        (6371 * acos(
          cos(radians(?)) * cos(radians(latitude)) *
          cos(radians(longitude) - radians(?)) +
          sin(radians(?)) * sin(radians(latitude))
        )) AS distance
       FROM shopkeepers
       HAVING distance < 1
       ORDER BY distance ASC
       LIMIT 1`,
      [latitude, longitude, latitude]
    );

    if (!nearestShop.length) {
      return res.status(400).json({ message: "No shopkeeper nearby to fulfill order" });
    }

    const shopkeeper_id = nearestShop[0].id;

    // Convert lat/lng → readable address
    const deliveryAddress = await getAddressFromCoords(latitude, longitude)
      .catch(() => "Unknown Address");

    // Calculate total
    const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

    // Calculate earned credits
    const earnedCredits = calculateCredits(total);

    await conn.beginTransaction();

    // Insert order WITH shopkeeper_id
    const [orderResult] = await conn.query(
      `INSERT INTO orders 
       (user_id, shopkeeper_id, total_amount, status, credits_earned, latitude, longitude, delivery_address) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [user_id, shopkeeper_id, total, "Pending", earnedCredits, latitude, longitude, deliveryAddress]
    );

    const orderId = orderResult.insertId;

    // Validate all products exist in the selected shop and have sufficient stock
    const productIds = items.map(i => i.product_id);
    const [shopProducts] = await conn.query(
      "SELECT id, name, stock, price FROM products WHERE shop_id = ? AND id IN (?)",
      [shopkeeper_id, productIds]
    );

    const availableProductIds = shopProducts.map(p => p.id);
    const missingProducts = productIds.filter(id => !availableProductIds.includes(id));
    if (missingProducts.length > 0) {
      await conn.rollback();
      return res.status(400).json({ message: `Products not available at selected shop: ${missingProducts.join(', ')}` });
    }

    // Check stock availability
    const stockIssues = [];
    for (const item of items) {
      const prod = shopProducts.find(p => p.id === item.product_id);
      if (prod && prod.stock < item.quantity) {
        stockIssues.push(`Product ${item.product_id}: requested ${item.quantity}, available ${prod.stock}`);
      }
    }
    if (stockIssues.length > 0) {
      await conn.rollback();
      return res.status(400).json({ message: `Insufficient stock: ${stockIssues.join('; ')}` });
    }

    // Bulk insert items using product_id
    const values = items.map(i => [orderId, i.product_id, i.quantity, i.price]);
    await conn.query("INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ?", [values]);

    // Update stock in products table
    for (const item of items) {
      await conn.query("UPDATE products SET stock = stock - ? WHERE id = ?", [item.quantity, item.product_id]);
    }

    // Update user's store credits balance
    if (earnedCredits > 0) {
      await conn.query(
        "UPDATE users SET store_credits = store_credits + ? WHERE id = ?",
        [earnedCredits, user_id]
      );
    }

    await conn.commit();

    // Fetch full order details (with shopkeeper info)
    const [orderDetails] = await pool.query(
      `SELECT 
          o.id AS orderId, 
          o.total_amount, 
          o.status, 
          o.credits_earned,
          o.latitude,
          o.longitude,
          o.delivery_address,
          o.created_at,
          u.id AS customer_id, 
          u.name AS customer_name, 
          u.email AS customer_email,
          u.phone AS customer_phone,
          s.id AS shopkeeper_id,
          s.name AS shopkeeper_name,
          s.phone AS shopkeeper_phone,
          oi.product_id, 
          p.name AS product_name, 
          p.image AS product_image,
          oi.quantity, 
          oi.price
       FROM orders o
       JOIN users u ON o.user_id = u.id
       JOIN shopkeepers s ON o.shopkeeper_id = s.id
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       WHERE o.id = ?`,
      [orderId]
    );

    const orderPayload = {
      orderId,
      customer: {
        id: orderDetails[0].customer_id,
        name: orderDetails[0].customer_name,
        email: orderDetails[0].customer_email,
        phone: orderDetails[0].customer_phone,
        address: orderDetails[0].delivery_address,
      },
      shopkeeper: {
        id: orderDetails[0].shopkeeper_id,
        name: orderDetails[0].shopkeeper_name,
        phone: orderDetails[0].shopkeeper_phone,
      },
      total: orderDetails[0].total_amount,
      credits_earned: earnedCredits,
      credits_value: earnedCredits * 0.5,
      status: orderDetails[0].status,
      created_at: orderDetails[0].created_at,
      latitude: orderDetails[0].latitude,
      longitude: orderDetails[0].longitude,
      items: orderDetails.map((row) => ({
        product_id: row.product_id,
        product_name: row.product_name,
        product_image: row.product_image,
        quantity: row.quantity,
        price: row.price,
      })),
    };

    // Emit to specific rooms
    if (req.io) {
      req.io.to(`shop_${shopkeeper_id}`).emit("newOrder", orderPayload);
      req.io.to(`customer_${user_id}`).emit("newOrder", orderPayload);
    }

    res.status(201).json({
      success: true,
      message: "Order created and assigned to nearest shopkeeper",
      order: orderPayload,
    });

  } catch (err) {
    await conn.rollback();
    console.error("Error creating order:", err);
    console.error("Error stack:", err.stack);
    console.error("Request body:", req.body);
    res.status(500).json({ message: "Server error" });
  } finally {
    conn.release();
  }
});

/**
 * Update order status (Shopkeeper role in future)
 */
ordersRouter.patch("/:id/status", verifyToken, async (req, res) => {
  try {
    const { status } = req.body;
    const orderId = Number(req.params.id);
    if (!orderId || isNaN(orderId)) return res.status(400).json({ message: "Invalid order ID" });

    const validStatuses = ["Pending", "Processing", "Delivered", "Cancelled"];
    if (!validStatuses.includes(status)) return res.status(400).json({ message: "Invalid status" });

    const [result] = await pool.query("UPDATE orders SET status = ? WHERE id = ?", [status, orderId]);
    if (!result.affectedRows) return res.status(404).json({ message: "Order not found" });

    if (req.io) req.io.emit("orderStatusUpdate", { orderId, status });

    res.json({ success: true, message: `Order status updated to ${status}`, status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * Get customer's orders (Updated for shop_products structure)
 */
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

/**
 * Get live orders (Updated for shop_products structure)
 */
ordersRouter.get("/live", verifyToken, async (req, res) => {
  try {
    const shopkeeper_id = req.user.id; // Get shopkeeper ID from token
    
    const [orders] = await pool.query(
      `SELECT 
        o.id AS order_id, 
        o.status, 
        o.total_amount, 
        o.created_at,
        o.delivery_address,
        o.latitude,
        o.longitude,
        o.user_id,
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
        ANY_VALUE(u.phone) AS customer_phone,
        ANY_VALUE(u.email) AS customer_email
     FROM orders o
     JOIN order_items oi ON o.id = oi.order_id
     JOIN products p ON oi.product_id = p.id
     JOIN users u ON o.user_id = u.id
     WHERE o.status IN ('Pending', 'Processing', 'Delivered', 'Cancelled')
       AND o.shopkeeper_id = ?
     GROUP BY o.id
     ORDER BY o.created_at DESC`,
     [shopkeeper_id]
    );

    res.json({ success: true, orders });
  } catch (err) {
    console.error("❌ Error fetching shopkeeper orders:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// shopkeeperRouter.get("/orders", verifyToken, async (req, res) => {
//   try {
//     const shopkeeper_id = req.user.id;
//     const { status } = req.query; // Optional filter by status

//     let whereClause = "WHERE o.shopkeeper_id = ?";
//     const params = [shopkeeper_id];

//     if (status) {
//       whereClause += " AND o.status = ?";
//       params.push(status);
//     }

//     const [orders] = await pool.query(
//       `SELECT 
//         o.id AS order_id,
//         o.user_id,
//         o.status,
//         o.total_amount,
//         o.created_at,
//         o.credits_earned,
//         o.latitude,
//         o.longitude,
//         o.delivery_address,
//         u.name AS customer_name,
//         u.phone AS customer_phone,
//         u.email AS customer_email,
//         JSON_ARRAYAGG(
//           JSON_OBJECT(
//             'product_id', sp.product_id,
//             'product_name', p.name,
//             'product_image', p.image,
//             'quantity', oi.quantity,
//             'price', oi.price,
//             'id', sp.product_id,
//             'name', p.name,
//             'image', p.image
//           )
//         ) AS items
//        FROM orders o
//        JOIN users u ON o.user_id = u.id
//        JOIN order_items oi ON o.id = oi.order_id
//        JOIN shop_products sp ON oi.shop_product_id = sp.id
//        JOIN products p ON sp.product_id = p.id
//        ${whereClause}
//        GROUP BY o.id
//        ORDER BY o.created_at DESC`,
//       params
//     );

//     res.json({ success: true, orders });
//   } catch (err) {
//     console.error("Get shopkeeper orders error:", err);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// });
export default ordersRouter;