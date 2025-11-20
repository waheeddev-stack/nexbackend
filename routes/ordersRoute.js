import express from "express";
import verifyToken from "../middleware/authMiddleware.js";
import {
  createOrder,
  updateOrderStatus,
  getMyOrders,
  getLiveOrders,
} from "../controllers/ordersControllers.js";

const ordersRouter = express.Router();
// CREATE ORDER -> notify shopkeeper
ordersRouter.post("/addorders", verifyToken, createOrder);
// UPDATE ORDER STATUS -> notify customer
ordersRouter.patch("/:id/status", verifyToken, updateOrderStatus);
// GET MY ORDERS
ordersRouter.get("/myorders", verifyToken, getMyOrders);
// GET LIVE ORDERS
ordersRouter.get("/live", verifyToken, getLiveOrders);

export default ordersRouter;
