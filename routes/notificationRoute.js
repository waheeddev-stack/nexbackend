import express from "express";
import { sendNotification } from "../controllers/notificationControllers.js";
const notificationRouter = express.Router();

// POST /send
notificationRouter.post("/sendnotification/v1", sendNotification);
export default notificationRouter;
