import express from "express";
import { sendNotification } from "../controllers/notificationControllers.js";
const notificationRouter = express.Router();

// POST /send
notificationRouter.post("/sendnotification", sendNotification);
export default notificationRouter;
