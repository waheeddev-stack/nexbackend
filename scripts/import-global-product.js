#!/usr/bin/env node
/**
 * Fetch a global product from inventory-backend and upload it to nexbackend DB (products table)
 *
 * Usage:
 *   node scripts/import-global-product.js --globalId 5 --shopId 1 [--stock 10] [--price 99.50]
 *   node scripts/import-global-product.js --globalId 5 --shopId 1 --via-db   # direct Postgres->TiDB without HTTP
 *
 * Env required (or .env):
 *   DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT, DB_SSL (TiDB nexkiranadb)
 *   INVENTORY_BACKEND_URL (default https://inventory-backend-lgpi.onrender.com)
 *   INVENTORY_DATABASE_URL or DATABASE_URL pointing to Neon Postgres (for --via-db)
 *   JWT_SECRET (shared with inventory-backend) to mint a service token for HTTP fetch
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import nodeFetch from "node-fetch";
import imagekit from "../config/imagekit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { out[key] = next; i++; }
      else out[key] = true;
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const globalId = Number(args.globalId || args.id || args.global_id || 5);
const shopId = Number(args.shopId || args.shop_id || 1);
const viaDb = !!args.viaDb || !!args["via-db"];
const stockArg = args.stock != null ? Number(args.stock) : null;
const priceArg = args.price != null ? Number(args.price) : null;
const mrpArg = args.mrp != null ? Number(args.mrp) : null;

if (!globalId || !shopId) {
  console.error("Usage: node scripts/import-global-product.js --globalId <id> --shopId <shopkeeper_id> [--stock N] [--price N] [--via-db]");
  process.exit(1);
}

const INVENTORY_URL = process.env.INVENTORY_BACKEND_URL || "https://inventory-backend-lgpi.onrender.com";

async function fetchGlobalViaHttp(id) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set - cannot mint service token");
  // Mint a shopkeeper token (inventory-backend verifyShopkeeperToken accepts any role, but admin is safest)
  const token = jwt.sign({ id: shopId, role: "shopkeeper", email: "import@service.local" }, secret, { expiresIn: "1h" });
  console.log(`→ Fetching global product ${id} via HTTP ${INVENTORY_URL}/api/shopkeeper/global-products`);
  const res = await fetch(`${INVENTORY_URL}/api/shopkeeper/global-products`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0,500)}`);
  }
  const json = await res.json();
  const list = json.products || json.data || [];
  const found = list.find((p) => Number(p.id) === Number(id));
  if (!found) throw new Error(`Global product ${id} not found (list size ${list.length})`);
  return found;
}

async function fetchGlobalViaDb(id) {
  const { Pool } = await import("pg");
  const connStr = process.env.INVENTORY_DATABASE_URL || process.env.DATABASE_URL || "postgresql://neondb_owner:npg_ZnYoLg6l5mIJ@ep-jolly-mountain-azq3988o-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
  console.log(`→ Fetching global product ${id} via direct Postgres ${connStr.split("@")[1]?.split("/")[0] || "neon"}...`);
  const pgPool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  const r = await pgPool.query("SELECT id, name, price, category, description, image, images, barcode, brand, weight, unit, demand_score FROM global_products WHERE id = $1", [id]);
  await pgPool.end();
  if (r.rows.length === 0) throw new Error(`Global product ${id} not found in Postgres`);
  const row = r.rows[0];
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    category: row.category,
    description: row.description,
    image: row.image,
    images: row.images || (row.image ? [row.image] : []),
    barcode: row.barcode,
    brand: row.brand,
    weight: row.weight,
    unit: row.unit,
   };
}

// Download an image from a URL and upload to ImageKit.
async function reuploadImageToImageKit(imageUrl) {
  if (!imageUrl) return null;

   try {
    // Download image from URL
    const response = await nodeFetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }
    const buffer = await response.buffer();

    // Upload to ImageKit
    const streamifier = await import("streamifier");
    return new Promise((resolve, reject) => {
      const stream = imagekit.uploader.upload_stream(
        { folder: "products" },
        (error, result) => {
          if (error) return reject(error);
          resolve(result.secure_url);
        }
      );
      streamifier.default.createReadStream(buffer).pipe(stream);
    });
  } catch (error) {
    console.error(`Failed to re-upload image ${imageUrl}:`, error.message);
    return imageUrl; // Return original URL on failure
  }
}

async function main() {
  console.log(`\n=== Import global product ${globalId} → nexbackend shop ${shopId} ===`);

  // 1. Fetch global product
  let g;
  try {
    g = viaDb ? await fetchGlobalViaDb(globalId) : await fetchGlobalViaHttp(globalId);
  } catch (e) {
    // Fallback to DB if HTTP fails
    if (!viaDb) {
      console.warn(`⚠️ HTTP fetch failed: ${e.message} — trying direct DB fallback`);
      g = await fetchGlobalViaDb(globalId);
    } else throw e;
  }
  console.log("✓ Global product:", { id: g.id, name: g.name, price: g.price, barcode: g.barcode, image: g.image?.slice(0,60) });

  // 2. Check shop exists
  const [shopRows] = await pool.execute("SELECT id, shop_name FROM shopkeepers WHERE id = ? LIMIT 1", [shopId]);
  if (shopRows.length === 0) {
    console.error(`✗ Shopkeeper ${shopId} not found`);
    process.exit(1);
  }
  console.log(`✓ Shop: ${shopRows[0].shop_name} (id=${shopId})`);

  // 3. Check already imported
  const [exists] = await pool.execute("SELECT id FROM products WHERE shop_id = ? AND global_product_id = ? LIMIT 1", [shopId, globalId]);
  if (exists.length) {
    console.log(`⚠️ Already imported as product id ${exists[0].id} — skipping. Use DELETE first to re-import.`);
    process.exit(0);
  }
  if (g.barcode) {
    const [dupBarcode] = await pool.execute("SELECT id FROM products WHERE shop_id = ? AND barcode = ? LIMIT 1", [shopId, g.barcode]);
    if (dupBarcode.length) {
      console.error(`✗ Duplicate barcode ${g.barcode} already exists for this shop as product ${dupBarcode[0].id}`);
      process.exit(1);
    }
  }

  // 4. Map fields
  const name = g.name;
  const category = g.category || null;
  const description = g.description || null;
  const barcode = g.barcode || null;
  const parsedPrice = priceArg != null ? priceArg : Number(g.price);
  const formattedPrice = parseFloat(parsedPrice.toFixed(2));
  const parsedMrp = mrpArg != null ? mrpArg : formattedPrice;
  const formattedMrp = parseFloat(parsedMrp.toFixed(2));
   const finalBaselineQty = stockArg != null ? stockArg : 7;
   const finalStock = finalBaselineQty;
   const imageUrl = g.image || (Array.isArray(g.images) && g.images[0]) || null;
   const imagesArr = Array.isArray(g.images) && g.images.length ? g.images : (imageUrl ? [imageUrl] : []);

   // Re-upload images from Cloudinary to ImageKit
   console.log(`Re-uploading ${imagesArr.length} image(s) from Cloudinary to ImageKit for product: ${name}`);
   let imagekitImageUrls = [];
   for (let i = 0; i < imagesArr.length; i++) {
     const cloudinaryUrl = imagesArr[i];
     const imagekitUrl = await reuploadImageToImageKit(cloudinaryUrl);
     imagekitImageUrls.push(imagekitUrl || cloudinaryUrl); // Use original if re-upload fails
   }

   // Extract primary image and convert array to single image with ImageKit URLs
   const finalImageUrl = imagekitImageUrls[0] || imageUrl;
   const finalImagesArr = imagekitImageUrls.length ? imagekitImageUrls : (finalImageUrl ? [finalImageUrl] : []);

   // 5. Insert
   const [result] = await pool.execute(
     `INSERT INTO products (shop_id, name, description, category, price, mrp, stock, baselineQty, image, images, global_product_id, barcode, available_stock)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
     [shopId, name.trim(), description, category, formattedPrice, formattedMrp, finalStock, finalBaselineQty, finalImageUrl, JSON.stringify(finalImagesArr), globalId, barcode, finalStock > 0 ? "IN STOCK" : "OUT OF STOCK"]
   );
  console.log(`✅ Inserted as products.id=${result.insertId}`);

  const [created] = await pool.execute("SELECT * FROM products WHERE id = ?", [result.insertId]);
  console.log("→ Created:", { id: created[0].id, name: created[0].name, price: created[0].price, mrp: created[0].mrp, stock: created[0].stock, global_product_id: created[0].global_product_id, barcode: created[0].barcode });

  // 6. Verify via GET endpoint logic
  const [verify] = await pool.execute("SELECT COUNT(*) as c FROM products WHERE shop_id = ? ", [shopId]);
  console.log(`📦 Shop now has ${verify[0].c} products`);

  process.exit(0);
}

main().catch((e) => {
  console.error("✗ Fatal:", e);
  process.exit(1);
});
