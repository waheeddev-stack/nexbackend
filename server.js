import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";

import userrouter from "./routes/userRoute.js";
import shopkeeperRouter from "./routes/shopkeeperRoute.js";
import adminRouter from "./routes/adminRoute.js";
import ordersRouter from "./routes/ordersRoute.js";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Attach io instance to requests (for routes to use)
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Socket.IO: handle connections and room joins
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  // join as shopkeeper (socket.emit after auth on client)
  socket.on("joinShop", (shopkeeper_id) => {
    if (!shopkeeper_id) return;
    const room = `shop_${shopkeeper_id}`;
    socket.join(room);
    console.log(`Socket ${socket.id} joined ${room}`);
  });

  // join as customer
  socket.on("joinCustomer", (user_id) => {
    if (!user_id) return;
    const room = `customer_${user_id}`;
    socket.join(room);
    console.log(`Socket ${socket.id} joined ${room}`);
  });

  socket.on("leaveRoom", (room) => {
    if (!room) return;
    socket.leave(room);
    console.log(`Socket ${socket.id} left ${room}`);
  });

  socket.on("disconnect", (reason) => {
    console.log("Socket disconnected:", socket.id, reason);
  });
});

// Routes
app.use("/api/users/v1", userrouter);
app.use("/api/shopkeepers/v1", shopkeeperRouter);
app.use("/api/admin/v1", adminRouter);
app.use("/api/orders/v1", ordersRouter);

// Default route
app.get("/", (req, res) => {
  res.send("Server is running!");
});

// Server start
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
