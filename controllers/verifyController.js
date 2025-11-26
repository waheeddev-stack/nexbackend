import pool from "../config/db.js";
import jwt from "jsonwebtoken";
import { generateOtpCode, hashOtp, verifyOtpHash } from "../utils/otp.js";
import { sendVerificationEmail } from "../utils/email.js";
import { sendVerificationSms } from "../utils/sms.js";

// POST /verify
export const verifyOtp = async (req, res) => {
  try {
    const { userId, channel, otp, type = "user" } = req.body;
    if (!userId || !channel || !otp) return res.status(400).json({ success: false, message: "Missing parameters" });

    const [rows] = await pool.query(
      "SELECT * FROM otp_verifications WHERE user_id = ? AND channel = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1",
      [userId, channel]
    );
    if (!rows.length) return res.status(400).json({ success: false, message: "No OTP found" });
    const row = rows[0];
    if (new Date(row.expires_at) < new Date()) return res.status(400).json({ success: false, message: "OTP expired" });
    if (row.attempts >= 5) return res.status(429).json({ success: false, message: "Too many attempts" });

    const ok = await verifyOtpHash(otp, row.otp_hash);
    if (!ok) {
      await pool.query("UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = ?", [row.id]);
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    await pool.query("UPDATE otp_verifications SET consumed_at = NOW() WHERE id = ?", [row.id]);
    const table = type === "shopkeeper" ? "shopkeepers" : "users";
    await pool.query(`UPDATE ${table} SET is_verified = 1 WHERE id = ?`, [userId]);

    // issue tokens upon successful verification
    const payload = { sub: userId };
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "7d" });
    const refreshToken = jwt.sign(payload, process.env.REFRESH_JWT_SECRET || "refreshsecret", { expiresIn: process.env.REFRESH_JWT_EXPIRES_IN || "7d" });
    await pool.query(`UPDATE ${table} SET refresh_token = ? WHERE id = ?`, [refreshToken, userId]);

    return res.json({ success: true, token: accessToken, refreshToken });
  } catch (err) {
    console.error("Verify OTP error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /resend-otp
export const resendOtp = async (req, res) => {
  try {
    const { userId, channel, recipient, type = "user", ttlMinutes = 10 } = req.body;
    if (!userId || !channel || !recipient) return res.status(400).json({ success: false, message: "Missing parameters" });

    // rate limit: check last sent time
    const [lastRows] = await pool.query(
      "SELECT created_at FROM otp_verifications WHERE user_id = ? AND channel = ? ORDER BY created_at DESC LIMIT 1",
      [userId, channel]
    );
    if (lastRows.length) {
      const last = new Date(lastRows[0].created_at);
      const since = Date.now() - last.getTime();
      if (since < 30 * 1000) return res.status(429).json({ success: false, message: "Wait before requesting another OTP" });
    }

    const otp = generateOtpCode(6);
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    await pool.query(
      "INSERT INTO otp_verifications (user_id, channel, recipient, otp_hash, expires_at) VALUES (?, ?, ?, ?, ?)",
      [userId, channel, recipient, otpHash, expiresAt]
    );

    // send
    if (channel === "sms") {
      await sendVerificationSms(recipient, otp, { ttlMinutes });
    } else {
      await sendVerificationEmail(recipient, otp, { ttlMinutes });
    }

    return res.json({ success: true, message: "OTP sent" });
  } catch (err) {
    console.error("Resend OTP error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
