import express from "express";

const router = express.Router();

// Placeholder routes for orders
router.get("/", (req, res) => {
  res.json({ success: true, message: "Orders route working" });
});

export default router;