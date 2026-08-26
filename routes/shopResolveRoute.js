import express from "express";
import pool from "../config/db.js";

const router = express.Router();

router.post("/resolve", async (req, res) => {
  try {
    const { lat, lng } = req.body;

    if (
      lat == null ||
      lng == null ||
      isNaN(Number(lat)) ||
      isNaN(Number(lng))
    ) {
      return res
        .status(400)
        .json({ success: false, message: "lat and lng are required" });
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const MAX_DIST_KM = 1.0;
    const BBOX = 0.02;

    const minLat = userLat - BBOX;
    const maxLat = userLat + BBOX;
    const minLng = userLng - BBOX;
    const maxLng = userLng + BBOX;

    const [rows] = await pool.execute(
      `SELECT
          id,
          shop_name AS name,
          address,
          latitude,
          longitude,
          is_online,
          (6371 * ACOS(
            LEAST(1, GREATEST(-1,
            COS(RADIANS(?)) * COS(RADIANS(latitude)) *
            COS(RADIANS(longitude) - RADIANS(?)) +
            SIN(RADIANS(?)) * SIN(RADIANS(latitude))
            ))
          )) AS distance_km
        FROM shopkeepers
        WHERE is_verified = 1
          AND subscription_status NOT IN ('suspended')
          AND latitude BETWEEN ? AND ?
          AND longitude BETWEEN ? AND ?
        HAVING distance_km <= ?
        ORDER BY distance_km ASC
        LIMIT 5`,
      [userLat, userLng, userLat, minLat, maxLat, minLng, maxLng, MAX_DIST_KM]
    );

    res.json({
      success: true,
      shops: rows,
      serviceable: rows.length > 0,
    });
  } catch (err) {
    console.error("Shop resolve error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
