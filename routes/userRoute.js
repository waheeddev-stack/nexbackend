import express from "express";
import bcrypt from "bcryptjs";
import pool from "../config/db.js";
import dotenv from "dotenv";
import upload from "../config/upload.js";
import cloudinary from "../config/cloudinary.js";
import verifyToken from "../middleware/auth.js";
import { createJWEToken } from "../utils/jweToken.js";
import { generatereferralCode } from "./referralRoute.js";

dotenv.config();

const userrouter = express.Router();

// Find nearby shopkeepers and show their products
userrouter.get("/nearby-shops", async (req, res) => {
  try {
    // Audit log for incoming request
    console.log("🔍 Nearby shops incoming query:", req.query);

    const { latitude, longitude } = req.query;

    // include_offline is no longer used: ALL verified shops within range
    // are returned regardless of online/offline status.
    // The frontend uses `is_online` per-shop to show online/offline banners.

    // Default search radius to 0.7 Km, accept dynamic adjustments via radiusKm parameter
    // Support both radiusKm (older frontend) and radius (new frontend)
    // Handle the case where radius might be passed in meters
    let radiusValue =
      parseFloat(req.query.radiusKm) || parseFloat(req.query.radius) || 0.7;

    // HEURISTIC: If radiusValue is > 10, it's likely meters, convert to KM
    // This handles the "fallback" meters behavior mentioned by user
    if (radiusValue > 10) {
      console.log(
        `⚠️ Radius value ${radiusValue} detected as meters, converting to 1km fallback...`
      );
      radiusValue = radiusValue / 1000;
    }

    const radiusKm = radiusValue;

    if (!latitude || !longitude) {
      return res
        .status(400)
        .json({ success: false, message: "Missing location" });
    }

    // Handle coordinates with high precision (at least 6 decimal places)
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    // Ensure we are searching within at least 1.25km as requested
    // If the frontend sent something that resulted in 100m, we force it to 1.25km
    const finalRadiusKm = Math.max(radiusKm, 1.25);
    const radiusMeters = finalRadiusKm * 1000;

    console.log(
      `🔍 Nearby shops request: lat=${lat.toFixed(6)}, lng=${lng.toFixed(6)}, radius=${finalRadiusKm}km (${radiusMeters}m)`
    );

    // Bounding Box calculation for optimization (approx 111km per degree)
    // 🛡️ INCREASED SAFETY MARGIN: Using 1.5x the radius for the bounding box
    // to ensure no edge-case shop is missed before applying precise distance check
    const safetyFactor = 1.5;
    const latDelta = (finalRadiusKm * safetyFactor) / 111;
    const lngDelta =
      (finalRadiusKm * safetyFactor) / (111 * Math.cos((lat * Math.PI) / 180));

    const minLat = lat - latDelta;
    const maxLat = lat + latDelta;
    const minLng = lng - lngDelta;
    const maxLng = lng + lngDelta;

    // 🔍 Scan for all potential shops in the expanded bounding box
    // Both online and offline verified shops are included.
    // The `is_online` field is returned per-shop for the frontend to show banners.
    // Formula: (6371 * acos(cos(radians(user_lat)) * cos(radians(shop_lat)) * cos(radians(shop_lng) - radians(user_lng)) + sin(radians(user_lat)) * sin(radians(shop_lat))))
    // Returns distance in km (not meters) to be compatible with formatDistance
    const [allPotentialShops] = await pool.execute(
      `SELECT id, name, shop_name, address, phone, latitude, longitude, img, is_online, is_verified, home_delivery_active,
              CASE
                WHEN latitude IS NOT NULL AND longitude IS NOT NULL AND latitude != 0 AND longitude != 0
                THEN (6371 * acos(
                   LEAST(1, GREATEST(-1,
                     cos(radians(?)) * cos(radians(latitude)) *
                     cos(radians(longitude) - radians(?)) +
                     sin(radians(?)) * sin(radians(latitude))
                   ))
                ))
                ELSE 999999
              END AS distance
       FROM shopkeepers
       WHERE is_verified = 1
         AND subscription_status NOT IN ('suspended')
       HAVING distance <= ? OR distance = 999999
       ORDER BY distance ASC`,
      [lat, lng, lat, finalRadiusKm]
    );

    console.log(
      `🔍 Initial scan: Found ${allPotentialShops.length} potential shops within ${radiusMeters}m`
    );

    // 🎯 STRICT VERIFICATION: Re-verify distance for each potential shop
    let verifiedShops = [];
    if (allPotentialShops.length > 0) {
      console.log("🕵️ Starting strict re-verification for potential shops...");

      for (const shop of allPotentialShops) {
        // Re-verify distance in Node.js for absolute precision (Double verification)
        const R = 6371; // Earth's radius in km
        const dLat = ((shop.latitude - lat) * Math.PI) / 180;
        const dLon = ((shop.longitude - lng) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((lat * Math.PI) / 180) *
          Math.cos((shop.latitude * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const verifiedDistance = R * c * 1000; // Meters

        console.log(
          `   - Verifying ${shop.shop_name}: SQL dist=${shop.distance.toFixed(2)}m, Node dist=${verifiedDistance.toFixed(2)}m, is_online=${shop.is_online}`
        );

        if (verifiedDistance > radiusMeters) {
          console.log(
            `     ❌ Rejected: Distance ${verifiedDistance.toFixed(2)}m exceeds ${radiusMeters}m limit.`
          );
          continue;
        }

        // Fresh status check: Re-verify verified status one last time
        const [[freshStatus]] = await pool.execute(
          "SELECT is_verified FROM shopkeepers WHERE id = ?",
          [shop.id]
        );

        if (freshStatus.is_verified !== 1) {
          console.log(
            `     ❌ Rejected ${shop.shop_name}: Verification status changed during processing.`
          );
          continue;
        }

        // All checks passed! Add this shop to the list.
        // Shops are included regardless of online/offline status or product availability.
        // The frontend uses `is_online` to show banners and `products[]` to show items.
        console.log(
          `🎯 INCLUDED: ${shop.shop_name} at ${verifiedDistance.toFixed(2)}m (${shop.is_online ? "online" : "offline"})`
        );
        verifiedShops.push(shop);
      }
    } else {
      console.log(
        `❌ No verified shops found within ${finalRadiusKm}km`
      );
    }

    // Check for unverified shops nearby (for debugging)
    const [unverifiedShops] = await pool.execute(
      `SELECT id, name, shop_name, is_verified, is_online,
              (6371 * acos(
                 LEAST(1, GREATEST(-1,
                   cos(radians(?)) * cos(radians(latitude)) *
                   cos(radians(longitude) - radians(?)) +
                   sin(radians(?)) * sin(radians(latitude))
                 ))
              )) AS distance
       FROM shopkeepers
       WHERE latitude IS NOT NULL 
         AND longitude IS NOT NULL
         AND latitude BETWEEN ? AND ?
         AND longitude BETWEEN ? AND ?
         AND latitude != 0 
         AND longitude != 0
         AND is_verified = 0
       HAVING distance <= ?
       ORDER BY distance ASC`,
      [lat, lng, lat, minLat, maxLat, minLng, maxLng, finalRadiusKm]
    );

    if (unverifiedShops.length > 0) {
      console.log(
        `⚠️ Found ${unverifiedShops.length} unverified shops nearby (not shown to users) within ${finalRadiusKm}km`
      );
    }

    if (verifiedShops.length === 0) {
      return res.json({ success: true, shops: [], hasOfflineShops: false });
    }

    // Fetch products for each shop directly from products table (products.shop_id)
    const shopIds = verifiedShops.map((s) => s.id);
    let products = [];

    if (shopIds.length > 0) {
      const placeholders = shopIds.map(() => "?").join(",");
      const [productsResult] = await pool.execute(
        `SELECT id AS product_id, shop_id, name, description, image, category, price, mrp, stock, created_at
         FROM products
         WHERE shop_id IN (${placeholders})
           AND (available_stock IS NULL OR available_stock != 'INVISIBLE')
         ORDER BY created_at DESC`,
        shopIds
      );
      products = productsResult;
    }

    console.log(
      `📦 Found ${products.length} products across ${shopIds.length} shops`
    );
    const hasOfflineShops = verifiedShops.some((s) => s.is_online === 0 || s.is_online === false);
    const shopsWithProducts = verifiedShops.map((shop) => ({
      ...shop,
      address:
        shop.address ||
        `Near coordinates (${parseFloat(shop.latitude).toFixed(4)}, ${parseFloat(shop.longitude).toFixed(4)})`,
      products: products
        .filter((p) => p.shop_id === shop.id)
        .map((p) => ({
          ...p,
          available_stock: p.stock == null || p.stock > 0 ? "IN STOCK" : "OUT OF STOCK",
          unit:
            p.stock == null || p.stock >= 5
              ? "In stock"
              : p.stock === 0
                ? "Out of stock"
                : p.stock === 1
                  ? "1 left"
                  : `${p.stock} left`,
        }))
    }));

    res.json({
      success: true,
      shops: shopsWithProducts,
      hasOfflineShops,
    });
  } catch (err) {
    console.error("Nearby shops error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PUBLIC: Get paginated products for a shop (used by "See All" page)
userrouter.post("/get-products", async (req, res) => {
  try {
    const { shopid, last_product_send_id, limit } = req.body;
    const shopId = parseInt(shopid);
    const pageLimit = Math.max(1, Math.min(parseInt(limit) || 50, 200));
    const fetchLimit = pageLimit + 1;
    const lastId = parseInt(last_product_send_id) || 0;

    if (!shopId || isNaN(shopId)) {
      return res.status(400).json({ success: false, message: "Invalid shop ID" });
    }

    let query;
    let params;
    if (lastId > 0) {
      query = `SELECT id AS product_id, shop_id, name, description, image, category, price, mrp, stock, created_at
               FROM products
               WHERE shop_id = ? AND id > ?
                 AND (available_stock IS NULL OR available_stock != 'INVISIBLE')
               ORDER BY id ASC
               LIMIT ?`;
      params = [shopId, lastId, fetchLimit];
    } else {
      query = `SELECT id AS product_id, shop_id, name, description, image, category, price, mrp, stock, created_at
               FROM products
               WHERE shop_id = ?
                 AND (available_stock IS NULL OR available_stock != 'INVISIBLE')
               ORDER BY id ASC
               LIMIT ?`;
      params = [shopId, fetchLimit];
    }

    const [rows] = await pool.query(query, params);
    const hasMore = rows.length > pageLimit;
    const products = rows.slice(0, pageLimit).map((p) => ({
      ...p,
      available_stock: p.stock == null || p.stock > 0 ? "IN STOCK" : "OUT OF STOCK",
      unit:
        p.stock == null || p.stock >= 5
          ? "In stock"
          : p.stock === 0
            ? "Out of stock"
            : p.stock === 1
              ? "1 left"
              : `${p.stock} left`,
    }));

    res.json({ success: true, products, hasMore });
  } catch (err) {
    console.error("Get products error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PUBLIC: Get shop info (for customers to check delivery settings)
userrouter.get("/shop-info/:shopId", async (req, res) => {
  try {
    const shopId = parseInt(req.params.shopId);

    if (!shopId || isNaN(shopId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid shop ID" });
    }

    const [shop] = await pool.execute(
      `SELECT id, name, shop_name, address, phone, latitude, longitude, 
              is_online, is_verified, home_delivery_active
       FROM shopkeepers 
       WHERE id = ? AND is_verified = 1 AND subscription_status NOT IN ('suspended')`,
      [shopId]
    );

    if (shop.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Shop not found" });
    }

    res.json({
      success: true,
      shop: shop[0],
    });
  } catch (err) {
    console.error("Shop info error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

import {
  createRateLimiter,
} from "../middleware/validation.js";

// Rate limiting for auth endpoints
const authRateLimit = createRateLimiter(15 * 60 * 1000, 5); // 5 attempts per 15 minutes

// REGISTER
userrouter.post(
  "/signup",
  authRateLimit,
  async (req, res) => {
    try {
      const validatedData = req.body;

      // Validate required fields
      if (!validatedData.name || !validatedData.name.trim()) {
        return res.status(400).json({ success: false, message: "Name is required" });
      }
      if (!validatedData.phone || !validatedData.phone.trim()) {
        return res.status(400).json({ success: false, message: "Phone number is required" });
      }

      // Check if user already exists
      const [existingUser] = await pool.execute(
        "SELECT * FROM users WHERE email = ?",
        [validatedData.email]
      );
      if (existingUser.length > 0) {
        return res
          .status(400)
          .json({ success: false, message: "User already exists" });
      }

      // Hash the password
      const hashedPassword = await bcrypt.hash(validatedData.password, 12); // Increased rounds for better security

      // Get the next available ID (since auto-increment isn't working)
      const [maxIdResult] = await pool.execute(
        "SELECT MAX(id) as maxId FROM users"
      );
      const nextId = (maxIdResult[0].maxId || 0) + 1;

      const MAX_ATTEMPTS = 5
      let inserted = false
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const referralcode = generatereferralCode(validatedData.name);
        try {
          // Insert new user into database with explicit ID
          await pool.execute(
            "INSERT INTO users (id, name, email, password, phone, referralcode) VALUES (?, ?, ?, ?, ?, ?)",
            [nextId, validatedData.name, validatedData.email, hashedPassword, validatedData.phone, referralcode]
          );
          inserted = true
          break;
        } catch (error) {
          if (error.errno === 1062) {
            continue
          }
          console.log("New User couldn't be added: " + error)
          break
        }
      }

      if (!inserted) {
        return res.status(500).json({
          success: false,
          message: "Failed to register user. Please try again.",
        })
      }

      // Fetch the newly created user
      const [userRows] = await pool.execute(
        "SELECT id, name, email, phone, store_credits, created_at FROM users WHERE id = ?",
        [nextId]
      );
      const user = userRows[0];

      return res.json({
        success: true,
        user,
        message: "User registered successfully",
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// LOGIN
userrouter.post("/signin", authRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Basic validation
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Email and password are required" });
    }

    const [user] = await pool.execute("SELECT * FROM users WHERE email = ?", [
      email,
    ]);
    if (user.length === 0)
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });

    const validPass = await bcrypt.compare(password, user[0].password);
    if (!validPass)
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });

    // Defensive validation: Validate that user.id is not null before sending response
    if (!user[0].id || user[0].id === null || user[0].id === undefined) {
      console.error("⚠️ CRITICAL: User signin succeeded but user.id is null!", {
        email: user[0].email,
        userId: user[0].id,
      });
      return res.status(500).json({
        success: false,
        message: "Database error: User ID not found. Please contact support.",
      });
    }

    // Create JWE token with user info and role
    const token = await createJWEToken(
      {
        id: user[0].id,
        role: "user",
        email: user[0].email,
      },
      "7d"
    );

    // Response logging: Log complete response structure being sent
    console.log("✅ User signin successful:", {
      userId: user[0].id,
      email: user[0].email,
      tokenLength: token?.length || 0,
      tokenType: "JWE",
    });

    res.json({
      success: true,
      token,
      tokenType: "JWE",
      user: {
        id: user[0].id,
        email: user[0].email,
        name: user[0].name,
      },
    });
  } catch (err) {
    console.error("❌ Login error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error during login" });
  }
});

// PROFILE
userrouter.get("/profile/:id", async (req, res) => {
  try {
    const [user] = await pool.execute(
      "SELECT id, email, name, phone, address, area, landmark, pincode, img, wallet, store_credits, referralcode, created_at FROM users WHERE id = ?",
      [req.params.id]
    );
    if (user.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    console.log(`✅ Profile fetched for user ${req.params.id}:`, {
      id: user[0].id,
      email: user[0].email,
      name: user[0].name,
      hasAddress: !!user[0].address,
    });

    res.json({ success: true, user: user[0] });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// UPDATE PROFILE (with image upload)
userrouter.put("/profile/:id", upload.single("img"), async (req, res) => {
  try {
    const { name, phone, address, area, landmark, pincode } = req.body;
    const { id } = req.params;

    // First, check if user exists
    const [existingUser] = await pool.execute(
      "SELECT id FROM users WHERE id = ?",
      [id]
    );
    if (existingUser.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // VALIDATION: Name and phone are always required
    if (!name || name.trim().length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Name is required." });
    }

    if (!phone || phone.trim().length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Phone number is required." });
    }

    // NOTE: Address validation is NOT enforced here
    // Address is only required when placing HOME DELIVERY orders
    // Users can have empty address for STORE PICKUP orders
    // Address validation happens at order placement time

    let imgUrl = null;
    if (req.file) {
      // Use streamifier for cloudinary upload
      const streamifier = await import("streamifier");
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "users" },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        streamifier.default.createReadStream(req.file.buffer).pipe(stream);
      });
      imgUrl = result.secure_url;
      console.log("Cloudinary URL:", imgUrl);
    }

    const fields = [];
    const values = [];
    if (name) {
      fields.push("name = ?");
      values.push(name);
    }
    if (phone) {
      fields.push("phone = ?");
      values.push(phone);
    }
    if (address) {
      fields.push("address = ?");
      values.push(address);
    }
    if (area !== undefined) {
      fields.push("area = ?");
      values.push(area);
    }
    if (landmark !== undefined) {
      fields.push("landmark = ?");
      values.push(landmark);
    }
    if (pincode !== undefined) {
      fields.push("pincode = ?");
      values.push(pincode);
    }
    if (imgUrl) {
      fields.push("img = ?");
      values.push(imgUrl);
    }

    if (fields.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No fields to update" });
    }

    values.push(id);
    const sql = `UPDATE users SET ${fields.join(", ")} WHERE id = ?`;
    await pool.execute(sql, values);

    // Fetch updated user data
    const [userRows] = await pool.execute(
      "SELECT id, name, email, phone, address, area, landmark, pincode, img, store_credits, referralcode, created_at FROM users WHERE id = ?",
      [id]
    );

    // Save address to AsyncStorage for quick access
    if (address) {
      console.log(`✅ Profile updated for user ${id} with address: ${address}`);
    }

    res.json({
      success: true,
      user: userRows[0],
      message: "Profile updated successfully",
    });
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Save expo push token for authenticated user
userrouter.post("/push-token", verifyToken, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token)
      return res
        .status(400)
        .json({ success: false, message: "token is required" });

    await pool.execute("UPDATE users SET expo_push_token = ? WHERE id = ?", [
      token,
      req.user.id,
    ]);
    console.log(`✅ Push token saved for user ${req.user.id}`);
    return res.json({ success: true, message: "Push token saved" });
  } catch (err) {
    console.error("Save user push token error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

userrouter.get("/products", async (req, res) => {
  try {
    // If location is provided, we should ideally use nearby-shops logic,
    // but as a fallback/general products endpoint, we return products from all verified shops.
    const { latitude, longitude } = req.query;

    let query = `
      SELECT p.id AS product_id, p.shop_id, p.name, p.description, p.image, p.category, 
             p.price, p.mrp, p.stock, p.available_stock, s.shop_name AS shopName, s.address AS shopAddress
      FROM products p
      JOIN shopkeepers s ON p.shop_id = s.id
      WHERE s.is_verified = 1 AND s.subscription_status NOT IN ('suspended')
        AND (s.is_online = 1 OR s.is_online IS NULL)
        AND (p.available_stock IS NULL OR p.available_stock != 'INVISIBLE')
      ORDER BY p.created_at DESC
      LIMIT 50
    `;

    const [products] = await pool.execute(query);

    if (!latitude || !longitude) {
      console.log(
        "ℹ️ /products called without location - returning global products list"
      );
    }

    res.json({
      success: true,
      products: products,
      message:
        products.length > 0
          ? "Showing available products"
          : "No products available currently",
    });
  } catch (err) {
    console.error("Get products error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
// Get shop location for customer
userrouter.get("/shops/:shopId/location", verifyToken, async (req, res) => {
  try {
    const { shopId } = req.params;

    const [shop] = await pool.execute(
      `
      SELECT id, shop_name, name as shopkeeper_name, address, 
             latitude, longitude, phone, created_at
      FROM shopkeepers 
      WHERE id = ? AND is_verified = 1 AND subscription_status NOT IN ('suspended')
    `,
      [shopId]
    );

    if (shop.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Shop not found or not verified",
      });
    }

    const shopData = shop[0];

    res.json({
      success: true,
      shop: {
        id: shopData.id,
        name: shopData.shop_name,
        shopkeeper: shopData.shopkeeper_name,
        address: shopData.address,
        location: {
          latitude: shopData.latitude,
          longitude: shopData.longitude,
        },
        phone: shopData.phone,
        verified: true,
      },
    });
  } catch (err) {
    console.error("Get shop location error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

userrouter.get("/leaderboard", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [leaderboard] = await pool.execute(
      `SELECT id, store_credits, 
      DENSE_RANK() OVER (ORDER BY store_credits DESC) AS \`rank\` 
      FROM users ORDER BY store_credits DESC LIMIT 10;`
    );

    const [rows] = await pool.execute(
      `SELECT id, store_credits, \`rank\` FROM (
       SELECT id, store_credits,
        DENSE_RANK() OVER (ORDER BY store_credits DESC) AS \`rank\`
        FROM users
      ) ranked
     WHERE id = ?`,
      [userId]
    );

    const userRank = rows[0];

    if (!userRank) { return res.status(404).json({ success: false, message: "User is not found" }) };

    return res.status(200).json({ success: true, user_rank: userRank, leaderboard: leaderboard });
  } catch (err) {
    console.error("Leaderboard error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Submit a suggestion for a new shop
userrouter.post("/suggest-shop", verifyToken, async (req, res) => {
  try {
    const {
      shop_name,
      owner_name,
      phone,
      address,
      landmark,
      pincode,
      latitude,
      longitude,
      notes,
    } = req.body;
    const userId = req.user.id;

    // Validate required inputs
    if (!shop_name || typeof shop_name !== "string" || shop_name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Shop name is required.",
      });
    }

    if (!address || typeof address !== "string" || address.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Address is required.",
      });
    }

    if (!phone || typeof phone !== "string" || phone.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required.",
      });
    }

    if (!pincode || typeof pincode !== "string" || pincode.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Pincode is required.",
      });
    }

    // Insert suggestion into database
    const query = `
      INSERT INTO shop_suggestions 
      (user_id, shop_name, owner_name, phone, address, landmark, pincode, latitude, longitude, notes, status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `;

    const values = [
      userId,
      shop_name.trim(),
      owner_name ? owner_name.trim() : null,
      phone ? phone.trim() : null,
      address.trim(),
      landmark ? landmark.trim() : null,
      pincode.trim(),
      latitude !== undefined && latitude !== null && latitude !== "" ? parseFloat(latitude) : null,
      longitude !== undefined && longitude !== null && longitude !== "" ? parseFloat(longitude) : null,
      notes ? notes.trim() : null,
    ];

    const [result] = await pool.execute(query, values);

    res.status(201).json({
      success: true,
      message: "Shop suggestion submitted successfully",
      suggestion: {
        id: result.insertId,
        user_id: userId,
        shop_name: shop_name.trim(),
        owner_name: owner_name ? owner_name.trim() : null,
        phone: phone ? phone.trim() : null,
        address: address.trim(),
        landmark: landmark ? landmark.trim() : null,
        pincode: pincode.trim(),
        latitude: latitude !== undefined && latitude !== null && latitude !== "" ? parseFloat(latitude) : null,
        longitude: longitude !== undefined && longitude !== null && longitude !== "" ? parseFloat(longitude) : null,
        notes: notes ? notes.trim() : null,
        status: "pending",
        created_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("Suggest shop error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default userrouter;
