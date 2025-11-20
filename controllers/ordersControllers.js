import pool from "../config/db.js";
import fetch from "node-fetch";
import { sendExpoPush } from "../utils/expoPush.js";

async function getAddressFromCoords(latitude, longitude) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`;
  const res = await fetch(url, { headers: { "User-Agent": "nexkirana" } });
  const data = await res.json();
  return data?.display_name || null;
}

async function getCoordsFromAddress(address) {
  if (!address) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
    address
  )}&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": "nexkirana" } });
  const data = await res.json();
  if (Array.isArray(data) && data.length > 0) {
    return {
      latitude: parseFloat(data[0].lat),
      longitude: parseFloat(data[0].lon),
      display_name: data[0].display_name,
    };
  }
  return null;
}

function calculateCredits(amount) {
  if (amount >= 100 && amount <= 300) return 10;
  if (amount > 300 && amount <= 500) return 25;
  if (amount > 500) return 50;
  return 0;
}

// Create a new order
export const createOrder = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const rawItems = req.body.items;
    if (!rawItems || !Array.isArray(rawItems) || rawItems.length === 0)
      return res.status(400).json({ message: "No items provided" });

    const items = rawItems
      .map((it) => ({
        product_id: it.product_id ?? it.id,
        quantity: Number(it.quantity ?? it.qty ?? 0),
        price: Number(it.price ?? it.unit_price ?? 0),
      }))
      .filter((i) => i.product_id != null && i.quantity > 0);

    if (items.length === 0)
      return res.status(400).json({ message: "No valid items provided" });

    let { latitude, longitude, delivery_address, address, payment_method } =
      req.body;
    let credits_used = parseInt(req.body.credits_used ?? 0, 10);
    if (Number.isNaN(credits_used) || credits_used < 0) credits_used = 0;

    const user_id = req.user.id;

    delivery_address = delivery_address || address || null;
    latitude = latitude != null ? parseFloat(latitude) : null;
    longitude = longitude != null ? parseFloat(longitude) : null;

    if ((latitude == null || longitude == null) && delivery_address) {
      try {
        const geo = await getCoordsFromAddress(delivery_address);
        if (geo) {
          latitude = geo.latitude;
          longitude = geo.longitude;
          delivery_address = delivery_address || geo.display_name;
        }
      } catch (e) {
        console.warn("Geocoding failed:", e?.message || e);
      }
    }

    // determine shopkeeper (proximity first, fallback by availability)
    let shopkeeper_id = null;
    if (
      latitude != null &&
      longitude != null &&
      !isNaN(latitude) &&
      !isNaN(longitude)
    ) {
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
      if (nearestShop.length) shopkeeper_id = nearestShop[0].id;
    }

    if (!shopkeeper_id) {
      const productIds = items.map((i) => i.product_id);
      const [candidateRows] = await pool.query(
        "SELECT DISTINCT shop_id FROM products WHERE id IN (?)",
        [productIds]
      );
      const candidateShopIds = candidateRows.map((r) => r.shop_id);

      for (const sid of candidateShopIds) {
        const [prodRows] = await pool.query(
          "SELECT id, stock FROM products WHERE shop_id = ? AND id IN (?)",
          [sid, productIds]
        );
        const stockMap = new Map(prodRows.map((p) => [p.id, p.stock]));
        let ok = true;
        for (const it of items) {
          const stock = stockMap.get(it.product_id);
          if (stock == null || stock < it.quantity) {
            ok = false;
            break;
          }
        }
        if (ok) {
          shopkeeper_id = sid;
          break;
        }
      }
    }

    if (!shopkeeper_id)
      return res
        .status(400)
        .json({ message: "No shopkeeper available to fulfill order" });

    let resolvedAddress = delivery_address || null;
    if (!resolvedAddress && latitude != null && longitude != null) {
      try {
        resolvedAddress = await getAddressFromCoords(latitude, longitude).catch(
          () => null
        );
      } catch (e) {
        resolvedAddress = null;
      }
    }

    const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

    await conn.beginTransaction();

    const [userRows] = await conn.query(
      "SELECT COALESCE(store_credits,0) AS store_credits FROM users WHERE id = ? FOR UPDATE",
      [user_id]
    );
    const currentCredits = Number(userRows[0]?.store_credits ?? 0);

    if (credits_used > currentCredits) {
      await conn.rollback();
      return res.status(400).json({ message: "Insufficient store credits" });
    }

    const creditValuePerUnit = 0.5;
    const credits_value_used = credits_used * creditValuePerUnit;
    let total = subtotal - credits_value_used;
    if (total < 0) total = 0;

    const earnedCredits = calculateCredits(total);
    const credits_granted_flag = earnedCredits > 0 ? 1 : 0;

    const [orderResult] = await conn.query(
      `INSERT INTO orders 
       (user_id, shopkeeper_id, status, payment_method, total_amount, credits_earned, credits_used, credits_granted, latitude, longitude, delivery_address) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id,
        shopkeeper_id,
        "Pending",
        payment_method ? (payment_method === "upi" ? "upi" : "cod") : "cod",
        total.toFixed(2),
        earnedCredits.toFixed(2),
        credits_used,
        credits_granted_flag,
        latitude,
        longitude,
        resolvedAddress,
      ]
    );

    const orderId = orderResult.insertId;

    const productIds = items.map((i) => i.product_id);
    const [shopProducts] = await conn.query(
      "SELECT id, name, stock, price FROM products WHERE shop_id = ? AND id IN (?)",
      [shopkeeper_id, productIds]
    );

    const availableProductIds = shopProducts.map((p) => p.id);
    const missingProducts = productIds.filter(
      (id) => !availableProductIds.includes(id)
    );
    if (missingProducts.length > 0) {
      await conn.rollback();
      return res
        .status(400)
        .json({
          message: `Products not available at selected shop: ${missingProducts.join(
            ", "
          )}`,
        });
    }

    const stockIssues = [];
    for (const item of items) {
      const prod = shopProducts.find((p) => p.id === item.product_id);
      if (prod && prod.stock < item.quantity) {
        stockIssues.push(
          `Product ${item.product_id}: requested ${item.quantity}, available ${prod.stock}`
        );
      }
    }
    if (stockIssues.length > 0) {
      await conn.rollback();
      return res
        .status(400)
        .json({ message: `Insufficient stock: ${stockIssues.join("; ")}` });
    }

    const values = items.map((i) => [
      orderId,
      i.product_id,
      i.quantity,
      i.price,
    ]);
    await conn.query(
      "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ?",
      [values]
    );

    for (const item of items) {
      await conn.query("UPDATE products SET stock = stock - ? WHERE id = ?", [
        item.quantity,
        item.product_id,
      ]);
    }

    if (credits_used > 0) {
      await conn.query(
        "UPDATE users SET store_credits = COALESCE(store_credits,0) - ? WHERE id = ?",
        [credits_used, user_id]
      );
    }
    if (earnedCredits > 0) {
      await conn.query(
        "UPDATE users SET store_credits = COALESCE(store_credits,0) + ? WHERE id = ?",
        [earnedCredits, user_id]
      );
    }

    await conn.commit();

    // fetch updated credits + order details
    const [[updatedUserCredits]] = await pool.query(
      "SELECT COALESCE(store_credits, 0) AS store_credits FROM users WHERE id = ?",
      [user_id]
    );

    const [orderDetails] = await pool.query(
      `SELECT 
          o.id AS orderId, 
          o.total_amount, 
          o.status, 
          o.payment_method,
          o.credits_earned,
          o.credits_used,
          o.credits_granted,
          o.latitude,
          o.longitude,
          o.delivery_address,
          o.created_at,
          u.id AS customer_id, 
          u.name AS customer_name, 
          u.email AS customer_email,
          u.phone AS customer_phone,
          u.store_credits AS customer_credits,
          s.id AS shopkeeper_id,
          s.name AS shopkeeper_name,
          s.phone AS shopkeeper_phone,
          s.img AS shopkeeper_image,
          s.upi_id AS shopkeeper_upi,
          s.upi_qr AS shopkeeper_upi_qr,
          s.expo_push_token AS shopkeeper_push,
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

    const latestStoreCredits = Number(
      updatedUserCredits?.store_credits ??
        orderDetails[0]?.customer_credits ??
        0
    );

    const orderPayload = {
      orderId,
      customer: {
        id: orderDetails[0].customer_id,
        name: orderDetails[0].customer_name,
        email: orderDetails[0].customer_email,
        phone: orderDetails[0].customer_phone,
        address: orderDetails[0].delivery_address,
        store_credits: latestStoreCredits,
      },
      shopkeeper: {
        id: orderDetails[0].shopkeeper_id,
        name: orderDetails[0].shopkeeper_name,
        phone: orderDetails[0].shopkeeper_phone,
        image: orderDetails[0].shopkeeper_image,
        upi_id: orderDetails[0].shopkeeper_upi,
        upi_qr: orderDetails[0].shopkeeper_upi_qr,
      },
      payment_method: orderDetails[0].payment_method,
      total: Number(orderDetails[0].total_amount),
      credits_earned: Number(orderDetails[0].credits_earned || 0),
      credits_used: Number(orderDetails[0].credits_used || 0),
      credits_granted: Number(orderDetails[0].credits_granted) === 1,
      credits_value: Number(orderDetails[0].credits_earned || 0) * 0.5,
      status: orderDetails[0].status,
      created_at: orderDetails[0].created_at,
      latitude: orderDetails[0].latitude,
      longitude: orderDetails[0].longitude,
      items: orderDetails.map((row) => ({
        product_id: row.product_id,
        product_name: row.product_name,
        product_image: row.product_image,
        quantity: row.quantity,
        price: Number(row.price),
      })),
    };

    // sockets
    if (req.io) {
      req.io.to(`shop_${shopkeeper_id}`).emit("newOrder", orderPayload);
      req.io.to(`customer_${user_id}`).emit("newOrder", orderPayload);
    }

    // push to shopkeeper
    try {
      const shopPushToken = orderDetails[0].shopkeeper_push;
      if (shopPushToken) {
        const result = await sendExpoPush(
          shopPushToken,
          "📦 New Order Received!",
          `You have a new order (#${orderId}).`,
          {
            orderId,
            shopkeeper_id,
          }
        );

        if (result?.invalidTokens?.length) {
          await pool.query(
            "UPDATE shopkeepers SET expo_push_token = NULL WHERE expo_push_token IN (?)",
            [result.invalidTokens]
          );
          console.warn(
            "Cleared invalid shopkeeper tokens:",
            result.invalidTokens
          );
        }
        if (result?.nonExpoTokens?.length) {
          console.warn("Non-Expo tokens for shopkeeper:", result.nonExpoTokens);
        }
      }
    } catch (pushErr) {
      console.error("Shopkeeper push error:", pushErr);
    }

    return res
      .status(201)
      .json({ success: true, message: "Order created", order: orderPayload });
  } catch (err) {
    await conn.rollback();
    console.error("Error creating order:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    conn.release();
  }
};

//  UPDATE ORDER STATUS -> notify customer
export const updateOrderStatus = async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const { status } = req.body;
    if (!orderId || isNaN(orderId)) return res.status(400).json({ message: "Invalid order ID" });

    const validStatuses = ["Pending", "Processing", "Delivered", "Cancelled"];
    if (!validStatuses.includes(status)) return res.status(400).json({ message: "Invalid status" });

    const [updateResult] = await pool.query("UPDATE orders SET status = ? WHERE id = ?", [status, orderId]);
    if (!updateResult.affectedRows) return res.status(404).json({ message: "Order not found" });

    // socket broadcast
    if (req.io) req.io.emit("orderStatusUpdate", { orderId, status });

    // fetch customer push token
    const [[cust]] = await pool.query(
      `SELECT u.id AS user_id, u.expo_push_token
       FROM orders o
       JOIN users u ON o.user_id = u.id
       WHERE o.id = ?`,
      [orderId]
    );

    if (cust?.expo_push_token) {
      try {
        const pushResult = await sendExpoPush(cust.expo_push_token, "🛒 Order Update", `Your order #${orderId} is now ${status}.`, {
          orderId,
          status,
        });

        if (pushResult?.invalidTokens?.length) {
          await pool.query("UPDATE users SET expo_push_token = NULL WHERE expo_push_token IN (?)", [pushResult.invalidTokens]);
          console.warn("Cleared invalid user tokens:", pushResult.invalidTokens);
        }
        if (pushResult?.nonExpoTokens?.length) {
          console.warn("Non-Expo tokens for user:", pushResult.nonExpoTokens);
        }
      } catch (pushErr) {
        console.error("Customer push error:", pushErr);
      }
    }

    return res.json({ success: true, message: `Order status updated to ${status}`, status });
  } catch (err) {
    console.error("Update status error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// fetch myorder details
export const getOrderDetails = async (req, res) => {
  try {
    const userId = req.user.id;
    const [orders] = await pool.query(
      `SELECT o.id, o.status, o.payment_method, o.total_amount, o.created_at, o.credits_earned,
              JSON_ARRAYAGG(
                JSON_OBJECT(
                  'id', oi.product_id,
                  'quantity', oi.quantity,
                  'price', oi.price,
                  'name', p.name,
                  'image', p.image,
                  'payment_method', o.payment_method
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

    // fetch authoritative store_credits from users table
    const [[userRow]] = await pool.query(
      "SELECT COALESCE(store_credits,0) AS store_credits FROM users WHERE id = ?",
      [userId]
    );

    const ordersWithCreditsValue = orders.map((o) => ({
      ...o,
      credits_value: Number(o.credits_earned || 0) * 0.5,
    }));

    res.json({
      success: true,
      orders: ordersWithCreditsValue,
      store_credits: Number(userRow?.store_credits ?? 0),
      store_credits_value: Number(((userRow?.store_credits ?? 0) * 0.5).toFixed(2))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to fetch orders" });
  }
};

// fetch order live order
export const getLiveOrder = async (req, res) => {
  try {
    const shopkeeper_id = req.user.id;
    const [orders] = await pool.query(
      `SELECT 
        o.id AS order_id, 
        o.status, 
        o.payment_method,
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
};
