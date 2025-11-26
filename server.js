import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import userrouter from "./routes/userRoute.js";
import shopkeeperRouter from "./routes/shopkeeperRoute.js";
import adminRouter from "./routes/adminRoute.js";
import ordersRouter from "./routes/ordersRoute.js";
import notificationRouter from "./routes/notificationRoute.js";

dotenv.config();

const app = express();
const server = http.createServer(app);
// Configure allowed origins via env (comma-separated). Default includes common local Expo origins.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:19006,http://localhost:19000,http://localhost:19001,http://localhost:3000").split(",").map(s => s.trim()).filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // allow non-browser (mobile/native) requests
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
});

// Middleware
// Security middleware
app.use(helmet());

// Configure CORS for browser-based requests. Mobile/native clients often don't set an Origin,
// so we allow requests without an Origin while restricting browser origins.
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PATCH", "DELETE"],
  credentials: true,
}));

// Basic rate limiter to mitigate brute-force and abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Limit request body size
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

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
// app.use("/api/users/v1", userrouter);
// app.use("/api/shopkeepers/v1", shopkeeperRouter);
// app.use("/api/admin/v1", adminRouter);
// app.use("/api/orders/v1", ordersRouter);
// app.use("/api/notifications/v1", notificationRouter);

app.use("/api/users", userrouter);
app.use("/api/shopkeepers", shopkeeperRouter);
app.use("/api/admin", adminRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/notifications", notificationRouter);

// Default route
app.get("/", (req, res) => {
  res.send("Server is running!");
});

// Server start
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// Export app and server for testing
export { app, server };
