import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import dotenv from "dotenv";
import upload from "../config/upload.js";
import cloudinary from "../config/cloudinary.js";

dotenv.config();

const shopkeeperrouter = express.Router();

// SHOPKEEPER REGISTER
shopkeeperrouter.post("/signup", upload.single("img"), async (req, res) => {
  try {
    const { name, email, password, phone, address } = req.body;
    let imgUrl = null;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    // Check if shopkeeper already exists
    const [existingUser] = await pool.query("SELECT * FROM shopkeepers WHERE email = ?", [email]);
    if (existingUser.length > 0) {
      return res.status(400).json({ success: false, message: "Shopkeeper already exists" });
    }

    // Handle image upload to Cloudinary
    if (req.file) {
      await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "shopkeepers" },
          (error, result) => {
            if (error) return reject(error);
            imgUrl = result.secure_url;
            resolve();
          }
        );
        stream.end(req.file.buffer);
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO shopkeepers (name, email, password, phone, address, img) VALUES (?, ?, ?, ?, ?, ?)",
      [name, email, hashedPassword, phone, address, imgUrl]
    );
    const [userRows] = await pool.query("SELECT id, name, email, phone, address, img, created_at FROM shopkeepers WHERE id = ?", [result.insertId]);
    const user = userRows[0];
    return res.json({ success: true, user, message: "Shopkeeper registered successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// SHOPKEEPER LOGIN
shopkeeperrouter.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;
    const [user] = await pool.query("SELECT * FROM shopkeepers WHERE email = ?", [email]);
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

// SHOPKEEPER PROFILE
shopkeeperrouter.get("/profile/:id", async (req, res) => {
  try {
    const [user] = await pool.query("SELECT id, email, name, phone, address, img, created_at FROM shopkeepers WHERE id = ?", [req.params.id]);
    if (user.length === 0)
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
    res.json({ success: true, user: user[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// SHOPKEEPER UPDATE PROFILE
shopkeeperrouter.put("/profile/:id", upload.single("img"), async (req, res) => {
  try {
    const { name, phone, address } = req.body;
    const { id } = req.params;
    let imgUrl = null;
    if (req.file) {
      await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "shopkeepers" },
          (error, result) => {
            if (error) return reject(error);
            imgUrl = result.secure_url;
            resolve();
          }
        );
        stream.end(req.file.buffer);
      });
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
    const sql = `UPDATE shopkeepers SET ${fields.join(", ")} WHERE id = ?`;
    await pool.query(sql, values);
    const [userRows] = await pool.query("SELECT id, name, email, phone, address, img, created_at FROM shopkeepers WHERE id = ?", [id]);
    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: "Shopkeeper not found" });
    }
    res.json({ success: true, user: userRows[0], message: "Profile updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default shopkeeperrouter;
