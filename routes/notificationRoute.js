import express from "express";
import { sendExpoPush } from "../utils/expoPush.js";

const notificationRouter = express.Router();

notificationRouter.post("/send", async (req, res) => {
  const { token, title, body } = req.body;
  const result = await sendExpoPush(token, title, body);
  res.json({ success: true, result });
});

export default notificationRouter;
