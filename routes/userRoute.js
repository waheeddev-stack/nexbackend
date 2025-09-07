import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import dotenv from "dotenv";
import upload from "../config/upload.js";
import cloudinary from "../config/cloudinary.js";

dotenv.config();

const userrouter = express.Router();

// REGISTER
userrouter.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validate inputs
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    // Check if user already exists
    const [existingUser] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (existingUser.length > 0) {
      return res.status(400).json({ success: false, message: "User already exists" });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user into database
    const [result] = await pool.query(
      "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
      [name, email, hashedPassword]
    );

    // Fetch the newly created user
  const [userRows] = await pool.query("SELECT id, name, email, created_at FROM users WHERE id = ?", [result.insertId]);
  const user = userRows[0];

  return res.json({ success: true, user, message: "User registered successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// LOGIN
userrouter.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;

    const [user] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (user.length === 0)
      return res.status(401).json({ success: false, message: "Invalid credentials" });

    const validPass = await bcrypt.compare(password, user[0].password);
    if (!validPass)
      return res.status(401).json({ success: false, message: "Invalid credentials" });

    const token = jwt.sign({ id: user[0].id }, process.env.JWT_SECRET, { expiresIn: "1h" });
    res.json({ success: true, token, user: { id: user[0].id, email: user[0].email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PROFILE
userrouter.get("/profile/:id", async (req, res) => {
  try {
    const [user] = await pool.query("SELECT id, email, name, phone, address, img, created_at FROM users WHERE id = ?", [req.params.id]);
    if (user.length === 0)
      return res.status(404).json({ success: false, message: "User not found" });

    res.json({ success: true, user: user[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// UPDATE PROFILE (with image upload)
userrouter.put("/profile/:id", upload.single("img"), async (req, res) => {
  try {
    const { name, phone, address } = req.body;
    const { id } = req.params;
    let imgUrl = null;
    if (req.file) {
      // Use util.promisify for cloudinary upload
      const streamifier = await import('streamifier');
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
    if (name) { fields.push("name = ?"); values.push(name); }
    if (phone) { fields.push("phone = ?"); values.push(phone); }
    if (address) { fields.push("address = ?"); values.push(address); }
    if (imgUrl) { fields.push("img = ?"); values.push(imgUrl); }
    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }
    values.push(id);
    const sql = `UPDATE users SET ${fields.join(", ")} WHERE id = ?`;
    await pool.query(sql, values);
    const [userRows] = await pool.query("SELECT id, name, email, phone, address, img, created_at FROM users WHERE id = ?", [id]);
    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, user: userRows[0], message: "Profile updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
userrouter.get("/products", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM products ORDER BY created_at DESC");
    res.json({ success: true, products: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
export default userrouter;
