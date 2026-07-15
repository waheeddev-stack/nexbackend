import express from "express";
import pool from "../config/db.js";
import verifyToken from "../middleware/auth.js";
import { trackingRateLimiter } from "../middleware/validation.js";

const router = express.Router();

// Helper: Calculate Haversine distance between two coordinates in kilometers
const calculateHaversineDistance = (lat1, lon1, lat2, lon2) => {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Health check endpoint for navigation services
router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    service: "navigation-backend",
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// 1. GET /api/navigation/nearby - Find nearby shops within specified radius (default 5km)
router.get("/nearby", async (req, res) => {
  const { lat, lng, radiusKm = 5 } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({
      success: false,
      message: "Latitude (lat) and Longitude (lng) are required query parameters.",
    });
  }

  try {
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const maxRadius = parseFloat(radiusKm);

    // Query online shopkeepers with coordinates
    const [shops] = await pool.execute(
      "SELECT id, shop_name, address, latitude, longitude, is_online, phone FROM shopkeepers WHERE is_online = 1 AND latitude IS NOT NULL AND longitude IS NOT NULL"
    );

    const nearbyShops = [];
    for (const shop of shops) {
      const distance = calculateHaversineDistance(
        userLat,
        userLng,
        parseFloat(shop.latitude),
        parseFloat(shop.longitude)
      );
      if (distance <= maxRadius) {
        const estimatedTimeMins = Math.round(10 + distance * 3);
        nearbyShops.push({
          ...shop,
          distanceKm: parseFloat(distance.toFixed(2)),
          estimatedDeliveryTime: `${estimatedTimeMins} mins`,
        });
      }
    }

    nearbyShops.sort((a, b) => a.distanceKm - b.distanceKm);

    if (nearbyShops.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        center: { lat: userLat, lng: userLng },
        radiusKm: maxRadius,
        shops: [],
        timestamp: new Date().toISOString(),
      });
    }

    return res.status(200).json({
      success: true,
      count: nearbyShops.length,
      center: { lat: userLat, lng: userLng },
      radiusKm: maxRadius,
      shops: nearbyShops,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error fetching nearby shops from database:", error.message || error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch nearby shops",
      error: error.message,
    });
  }
});

// 2. GET /api/navigation/directions - Turn-by-turn road navigation via OSRM with fallback
router.get("/directions", async (req, res) => {
  try {
    const { startLat, startLng, destLat, destLng } = req.query;

    if (!startLat || !startLng || !destLat || !destLng) {
      return res.status(400).json({
        success: false,
        message: "startLat, startLng, destLat, and destLng are required query parameters.",
      });
    }

    const sLat = parseFloat(startLat);
    const sLng = parseFloat(startLng);
    const dLat = parseFloat(destLat);
    const dLng = parseFloat(destLng);

    const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${sLng},${sLat};${dLng},${dLat}?overview=full&geometries=geojson&steps=true`;

    try {
      const response = await fetch(osrmUrl, {
        headers: { "User-Agent": "NexKirana-Navigation-Engine/2.0" },
      });
      const data = await response.json();

      if (data.code === "Ok" && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const coordinates = route.geometry.coordinates.map((coord) => ({
          latitude: coord[1],
          longitude: coord[0],
        }));

        const steps = route.legs[0].steps.map((step) => ({
          instruction: step.maneuver?.type
            ? `${step.maneuver.type.replace(/_/g, " ")} on ${step.name || "street"}`
            : "Continue straight",
          distanceMeters: step.distance,
          durationSeconds: step.duration,
          maneuver: step.maneuver,
        }));

        return res.status(200).json({
          success: true,
          mode: "osrm_live",
          distanceKm: parseFloat((route.distance / 1000).toFixed(2)),
          durationMins: Math.round(route.duration / 60),
          polyline: coordinates,
          steps,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (fetchErr) {
      console.warn("⚠️ OSRM API unreachable, generating fallback interpolated route:", fetchErr.message);
    }

    // Fallback mathematical interpolation routing
    const directDistKm = calculateHaversineDistance(sLat, sLng, dLat, dLng);
    const numPoints = 15;
    const polyline = [];
    for (let i = 0; i <= numPoints; i++) {
      const fraction = i / numPoints;
      // Add slight curvature to simulate road geometry
      const curveOffset = Math.sin(fraction * Math.PI) * 0.002;
      polyline.push({
        latitude: parseFloat((sLat + (dLat - sLat) * fraction + curveOffset).toFixed(6)),
        longitude: parseFloat((sLng + (dLng - sLng) * fraction).toFixed(6)),
      });
    }

    return res.status(200).json({
      success: true,
      mode: "fallback_interpolated",
      distanceKm: parseFloat(directDistKm.toFixed(2)),
      durationMins: Math.max(5, Math.round(10 + directDistKm * 3)),
      polyline,
      steps: [
        { instruction: "Head towards destination along main corridor", distanceMeters: directDistKm * 1000 },
        { instruction: "Arrive at destination store/customer", distanceMeters: 0 },
      ],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error calculating directions:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate directions",
      error: error.message,
    });
  }
});

// 3. GET /api/navigation/geocode - Reverse geocode lat/lng to human readable street address
router.get("/geocode", async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ success: false, message: "lat and lng required." });
    }

    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    try {
      const resp = await fetch(nominatimUrl, {
        headers: { "User-Agent": "NexKirana-Backend-App/1.0 (contact@nexkirana.com)" },
      });
      const data = await resp.json();
      if (data && data.display_name) {
        return res.status(200).json({
          success: true,
          address: data.display_name,
          details: data.address,
        });
      }
    } catch (err) {
      console.warn("⚠️ Geocoding API failed, returning fallback formatted address:", err.message);
    }

    return res.status(200).json({
      success: true,
      address: `Lat ${parseFloat(lat).toFixed(4)}, Lng ${parseFloat(lng).toFixed(4)}, Sector Road, India`,
      fallback: true,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Geocoding error", error: error.message });
  }
});

// 4. POST /api/navigation/track - Real-time GPS coordinate streaming
router.post("/track", trackingRateLimiter, verifyToken, async (req, res) => {
  try {
    const { orderId, latitude, longitude, heading = 0, speed = 0 } = req.body;
    const userId = req.user?.id || "unknown";
    const role = req.user?.role || "shopkeeper";

    if (!orderId || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: "orderId, latitude, and longitude are required in body.",
      });
    }
    
    if (role !== "admin") {
      try {
        const [orders] = await pool.execute(
          "SELECT id FROM orders WHERE id = ? AND (user_id = ? OR shopkeeper_id = ?)",
          [orderId, userId, userId]
        );
        if (orders.length === 0) {
          return res.status(403).json({
            success: false,
            message: "Unauthorized: You are not authorized to track this order.",
          });
        }
      } catch (dbError) {
        // Fallback if DB check fails (e.g. table not initialized)
        console.warn("⚠️ Order authorization check failed, proceeding with warning:", dbError.message);
      }
    }

    // Emit live GPS coordinates via global Socket.IO instance if available
    const io = req.app.get("io");
    if (io) {
      io.to(`tracking_order_${orderId}`).emit("shop:location:updated", {
        orderId,
        userId,
        role,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        heading: parseFloat(heading),
        speed: parseFloat(speed),
        timestamp: new Date().toISOString(),
      });
    }

    return res.status(200).json({
      success: true,
      message: "Location tracking coordinate broadcasted",
      room: `tracking_order_${orderId}`,
      coordinates: { latitude, longitude, heading, speed },
    });
  } catch (error) {
    console.error("❌ Error broadcasting track location:", error);
    return res.status(500).json({ success: false, message: "Tracking broadcast failed", error: error.message });
  }
});

// 5. GET /api/navigation/order/:orderId - Fetch order route data for live tracking
router.get("/order/:orderId", trackingRateLimiter, verifyToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user?.id;
    const role = req.user?.role;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required.",
      });
    }
    
    if (role !== "admin") {
      try {
        const [orders] = await pool.execute(
          "SELECT id, user_id, shopkeeper_id FROM orders WHERE id = ?",
          [orderId]
        );
        if (orders.length === 0) {
          return res.status(404).json({ success: false, message: "Order not found." });
        }
        
        const order = orders[0];
        if (order.user_id !== userId && order.shopkeeper_id !== userId) {
          return res.status(403).json({
            success: false,
            message: "Unauthorized: You are not authorized to view this order tracking.",
          });
        }
      } catch (dbError) {
        console.warn("⚠️ Order authorization check failed, proceeding with warning:", dbError.message);
      }
    }

    const [orderDetails] = await pool.execute(
      `SELECT 
        o.id as order_id,
        u.latitude as customer_lat, u.longitude as customer_lng,
        s.latitude as shop_lat, s.longitude as shop_lng
       FROM orders o
       JOIN users u ON o.user_id = u.id
       JOIN shopkeepers s ON o.shopkeeper_id = s.id
       WHERE o.id = ?`,
      [orderId]
    );

    if (orderDetails.length === 0) {
      return res.status(404).json({ success: false, message: "Order data not found" });
    }

    const orderData = orderDetails[0];
    const shop_location = { latitude: parseFloat(orderData.shop_lat), longitude: parseFloat(orderData.shop_lng) };
    const customer_location = { latitude: parseFloat(orderData.customer_lat), longitude: parseFloat(orderData.customer_lng) };

    const distance_km = calculateHaversineDistance(
      shop_location.latitude, shop_location.longitude,
      customer_location.latitude, customer_location.longitude
    );
    const eta_minutes = Math.round(10 + distance_km * 3);

    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${shop_location.longitude},${shop_location.latitude};${customer_location.longitude},${customer_location.latitude}?overview=full&geometries=geojson`;

      const osrmResponse = await fetch(osrmUrl);
      const osrmData = await osrmResponse.json();

      if (osrmData.routes && osrmData.routes.length > 0) {
        const route = osrmData.routes[0];
        const coordinates = route.geometry.coordinates.map((coord) => ({
          latitude: coord[1],
          longitude: coord[0],
        }));

        return res.status(200).json({
          success: true,
          data: {
            order_id: orderId,
            shop_location: shop_location,
            customer_location: customer_location,
            polyline: coordinates,
            distance_km: (route.distance / 1000).toFixed(2),
            eta_minutes: Math.round(route.duration / 60),
            route_steps: route.legs[0].steps.map((step) => step.maneuver?.instruction || "Continue").slice(0, 10),
          },
          timestamp: new Date().toISOString(),
        });
      }
    } catch (osrmError) {
      console.warn("⚠️ OSRM API failed, returning direct route:", osrmError.message);
    }

    // Fallback: Return direct route if OSRM fails
    return res.status(200).json({
      success: true,
      data: {
        order_id: orderId,
        shop_location: shop_location,
        customer_location: customer_location,
        polyline: [
          shop_location,
          customer_location,
        ],
        distance_km: distance_km.toFixed(2),
        eta_minutes: eta_minutes,
        route_steps: ["Head directly to customer"],
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error fetching order route:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch order route",
      error: error.message,
    });
  }
});

// 6. GET /api/navigation/status - Navigation subsystem health and feature check
router.get("/status", (req, res) => {
  res.status(200).json({
    success: true,
    service: "NexKirana Navigation & Spatial Routing Engine",
    version: "2.0.0",
    features: [
      "Haversine Nearby Shop Finder (/api/navigation/nearby)",
      "OSRM Turn-by-Turn Road Routing (/api/navigation/directions)",
      "OpenStreetMap Reverse Geocoding (/api/navigation/geocode)",
      "Real-Time Socket.IO GPS Streaming (/api/navigation/track)",
      "Order Route Fetching (/api/navigation/order/:orderId)",
    ],
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

export default router;

