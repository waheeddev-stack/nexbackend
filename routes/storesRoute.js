import express from "express";
import pool from "../config/db.js";

const storesRouter = express.Router();

// Deterministic icon styling per store so the UI gets consistent visuals.
const ICON_STYLES = [
  { iconBg: "#FFF3E0", iconName: "storefront", iconColor: "#F97316" },
  { iconBg: "#E0F2FE", iconName: "basket", iconColor: "#0EA5E9" },
  { iconBg: "#F0FDF4", iconName: "leaf", iconColor: "#22C55E" },
  { iconBg: "#FEF2F2", iconName: "cart", iconColor: "#EF4444" },
  { iconBg: "#F5F3FF", iconName: "shop", iconColor: "#8B5CF6" },
];

/**
 * GET /api/stores
 * Public list of verified stores for the "Find a Store" screen.
 * Returns { success, stores } where each store matches the shape the
 * client StoreCard renders (name, tags, rating, reviews, distance, isOpen...).
 */
storesRouter.get("/", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, shop_name, address, phone, latitude, longitude,
              img, COALESCE(is_online, 1) AS is_online, home_delivery_active
       FROM shopkeepers
       WHERE is_verified = 1
         AND (subscription_status IS NULL
              OR subscription_status NOT IN ('suspended', 'grace_period'))
       ORDER BY id ASC
       LIMIT 100`
    );

    const stores = rows.map((shop, idx) => {
      const style = ICON_STYLES[idx % ICON_STYLES.length];
      const displayName = shop.shop_name || shop.name || "Local Store";
      const tags = [
        "Kirana",
        Number(shop.home_delivery_active) === 1 ? "Delivery" : "Pickup",
      ];

      return {
        id: shop.id,
        name: displayName,
        address: shop.address || "",
        phone: shop.phone || "",
        latitude: shop.latitude,
        longitude: shop.longitude,
        image: shop.img || null,
        tags,
        rating: "4.5",
        reviews: "0",
        distance: "",
        isOpen: Number(shop.is_online) === 1,
        ...style,
      };
    });

    res.json({ success: true, stores });
  } catch (err) {
    console.error("Get stores error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", stores: [] });
  }
});

export default storesRouter;
