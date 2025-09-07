import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import userrouter from "./routes/userRoute.js";
import shopkeeperRouter from "./routes/shopkeeperRoute.js";
import adminRouter from "./routes/adminRoute.js";
import ordersRouter from "./routes/ordersRoute.js";


dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/user", userrouter);
app.use("/api/shopkeeper", shopkeeperRouter);
app.use("/api/admin", adminRouter);
app.use("/api/orders", ordersRouter);


// Default route
app.get("/", (req, res) => {
  res.send("Server is running!");
});

// Server start
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
