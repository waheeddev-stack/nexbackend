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

  // Join as shopkeeper
  socket.on("joinShop", (shopkeeper_id) => {
    if (!shopkeeper_id) return;
    const room = `shop_${shopkeeper_id}`;
    socket.join(room);
    socket.shopkeeper_id = shopkeeper_id;
    console.log(`Socket ${socket.id} joined ${room}`);
    
    // Notify admin of shopkeeper connection
    socket.to("admin").emit("shopkeeperOnline", { shopkeeper_id, socket_id: socket.id });
  });

  // Join as customer
  socket.on("joinCustomer", (user_id) => {
    if (!user_id) return;
    const room = `customer_${user_id}`;
    socket.join(room);
    socket.user_id = user_id;
    console.log(`Socket ${socket.id} joined ${room}`);
    
    // Notify admin of customer connection
    socket.to("admin").emit("customerOnline", { user_id, socket_id: socket.id });
  });

  // Join as admin
  socket.on("joinAdmin", (admin_id) => {
    if (!admin_id) return;
    socket.join("admin");
    socket.admin_id = admin_id;
    console.log(`Socket ${socket.id} joined admin room`);
  });

  // Handle order status updates from shopkeeper
  socket.on("updateOrderStatus", (data) => {
    const { orderId, status, shopkeeperId } = data;
    
    // Broadcast to admin
    socket.to("admin").emit("orderStatusUpdate", { orderId, status, shopkeeperId });
    
    // Broadcast to specific customer if available
    if (data.customerId) {
      socket.to(`customer_${data.customerId}`).emit("orderStatusUpdate", { orderId, status });
    }
  });

  // Handle customer notifications
  socket.on("notifyCustomer", (data) => {
    const { customerId, message, shopkeeperId } = data;
    socket.to(`customer_${customerId}`).emit("notification", {
      type: "shopkeeper_message",
      message,
      shopkeeperId,
      timestamp: new Date().toISOString(),
    });
  });

  // Handle admin broadcasts
  socket.on("broadcastToShopkeepers", (message) => {
    if (socket.admin_id) {
      io.emit("adminBroadcast", {
        type: "shopkeeper",
        message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  socket.on("broadcastToCustomers", (message) => {
    if (socket.admin_id) {
      io.emit("adminBroadcast", {
        type: "customer", 
        message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  socket.on("notifyShopkeeper", (data) => {
    if (socket.admin_id) {
      const { shopkeeperId, message } = data;
      socket.to(`shop_${shopkeeperId}`).emit("adminNotification", {
        message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Handle room leaving
  socket.on("leaveRoom", (room) => {
    if (!room) return;
    socket.leave(room);
    console.log(`Socket ${socket.id} left ${room}`);
  });

  // Handle disconnection
  socket.on("disconnect", (reason) => {
    console.log("Socket disconnected:", socket.id, reason);
    
    // Notify admin of disconnections
    if (socket.shopkeeper_id) {
      socket.to("admin").emit("shopkeeperOffline", { 
        shopkeeper_id: socket.shopkeeper_id, 
        socket_id: socket.id 
      });
    }
    
    if (socket.user_id) {
      socket.to("admin").emit("customerOffline", { 
        user_id: socket.user_id, 
        socket_id: socket.id 
      });
    }
  });
});

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
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
