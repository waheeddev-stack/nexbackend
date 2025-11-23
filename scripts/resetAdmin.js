import dotenv from "dotenv";
import path from "path";
import bcrypt from "bcryptjs";
import pool from "../config/db.js";

// Load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// Simple CLI arg parsing: --email=... --password=...
const args = process.argv.slice(2);
const opts = {};
args.forEach((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/);
  if (m) opts[m[1]] = m[2];
});

const email = opts.email || process.env.ADMIN_EMAIL;
const password = opts.password || process.env.ADMIN_PASSWORD;

if (!email || !password) {
  console.error("Usage: node scripts/resetAdmin.js --email=you@host --password=secret\nOr set ADMIN_EMAIL and ADMIN_PASSWORD in your .env");
  process.exit(1);
}

(async () => {
  try {
    const [rows] = await pool.query("SELECT id FROM admins WHERE email = ?", [email]);
    const hashed = await bcrypt.hash(password, 10);

    if (rows.length > 0) {
      const id = rows[0].id;
      await pool.query("UPDATE admins SET password = ? WHERE id = ?", [hashed, id]);
      console.log(`Updated password for admin id=${id} email=${email}`);
    } else {
      const [result] = await pool.query("INSERT INTO admins (email, password) VALUES (?, ?)", [email, hashed]);
      console.log(`Created admin id=${result.insertId} email=${email}`);
    }

    process.exit(0);
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(2);
  }
})();
