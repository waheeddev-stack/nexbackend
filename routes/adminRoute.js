import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";
import {
  createProduct,
  deleteProduct,
  getAllCustomers,
  getAllOrders,
  getAllProducts,
  getAllshopkeepers,
  getDashboardStats,
  loginAdmin,
  registerAdmin,
  updateProduct,
} from "../controllers/adminControllers.js";
const adminRouter = express.Router();
// Fetch all shopkeepers (protected)
adminRouter.get("/shopkeepers", verifyToken, getAllshopkeepers);
// Fetch all customers/users (protected)
adminRouter.get("/customers", verifyToken, getAllCustomers);
// Admin Registration (only via backend, not frontend)
adminRouter.post("/register", registerAdmin);
//admin login
adminRouter.post("/login", loginAdmin);
// Admin dashboard stats (protected)
adminRouter.get("/dashboard", verifyToken, getDashboardStats);
// Fetch all global products (admin)
adminRouter.get("/global-products", verifyToken, getAllProducts);
// Create a global product (admin)
adminRouter.post("/global-products", verifyToken, createProduct);
// Update a global product (admin)
adminRouter.put("/global-products/:id", verifyToken, updateProduct);
// Delete a global product (admin)
adminRouter.delete("/global-products/:id", verifyToken, deleteProduct);
// Fetch all orders (admin)
adminRouter.get("/orders", verifyToken, getAllOrders);

export default adminRouter;
