// Adds `images` JSONB column to local global_products if missing, then syncs
// catalog rows from inventory-backend (incl. full image arrays).
import pool from "../config/db.js";

try {
  const [cols] = await pool.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'global_products'");
  const names = cols.map((c) => c.column_name);
  console.log("global_products columns:", names.join(", "));
  if (!names.includes("images")) {
    console.log("Adding missing 'images' JSONB column to global_products...");
    await pool.execute("ALTER TABLE global_products ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'");
    console.log("✅ 'images' column added");
  } else {
    console.log("✅ 'images' column already exists");
  }
  process.exit(0);
} catch (e) {
  console.error("ERR:", e.message);
  process.exit(1);
}
