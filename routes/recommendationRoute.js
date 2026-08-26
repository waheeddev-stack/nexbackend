import express from "express";
import verifyToken from "../middleware/auth.js";
import { getRecommendationsForUser } from "../services/recommendation.service.js";

const router = express.Router();

router.get("/", verifyToken, async (req, res) => {
  try {
    const userId = Number(
      req.user?.id || req.query.user_id || req.params.userId
    );
    const topN = Number(req.query.top_n || req.query.topN || 5);

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "A valid user id is required",
      });
    }

    const recommendations = await getRecommendationsForUser(userId, { topN });

    return res.json({
      success: true,
      recommendations,
      user_id: userId,
    });
  } catch (error) {
    console.error("Recommendation route error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate recommendations",
      error: error.message,
    });
  }
});

export default router;
