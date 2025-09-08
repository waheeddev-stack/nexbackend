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
const server = http.createServer(app); // ⬅ create server
const io = new Server(server, {
  cors: {
    origin: [
      "http://10.60.26.149:8081", // Shopkeeper app
      "http://10.60.26.149:8082", // Customer app
    ],
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

// Routes
app.use("/api/user", userrouter);
app.use("/api/shopkeeper", shopkeeperRouter);
app.use("/api/admin", adminRouter);
app.use("/api/orders", ordersRouter);

// Default route
app.get("/", (req, res) => {
  res.send("Server is running!");
});

// Socket.io connection
io.on("connection", (socket) => {
  console.log("⚡ User connected:", socket.id);

  // Example: join shopkeeper/customer rooms
  socket.on("joinRoom", (room) => {
    socket.join(room);
    console.log(`📌 User joined room: ${room}`);
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

// Server start
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
