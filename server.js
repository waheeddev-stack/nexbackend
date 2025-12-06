import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

import userrouter from "./routes/userRoute.js";
import shopkeeperRouter from "./routes/shopkeeperRoute.js";
import adminRouter from "./routes/adminRoute.js";
import ordersRouter from "./routes/ordersRoute.js";
import notificationRouter from "./routes/notificationRoute.js";
import db from "./config/db.js";

// Import security and configuration
import { getConfig, validateEnvironment } from "./config/environment.js";
import securityMiddleware from "./middleware/security.js";
import { createRateLimiter } from "./middleware/validation.js";

// Validate environment on startup
try {
  validateEnvironment();
  console.log('✅ Environment validation passed');
} catch (error) {
  console.error('❌ Environment validation failed:', error.message);
  process.exit(1);
}

const config = getConfig();

console.log('🚀 Starting NexKirana Backend Server...');
if (config.NODE_ENV !== 'production') {
  console.log('Environment Variables Check:');
  console.log('- NODE_ENV:', config.NODE_ENV);
  console.log('- PORT:', config.PORT);
  console.log('- DB_HOST:', config.database.host ? 'SET' : 'NOT SET');
  console.log('- DB_SSL:', config.database.ssl);
  console.log('- JWT_SECRET:', config.JWT_SECRET ? 'SET' : 'NOT SET');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: securityMiddleware.corsConfig,
});

// Trust proxy (for rate limiting and IP detection)
app.set('trust proxy', 1);

// Security middleware (must be first)
app.use(securityMiddleware.securityHeaders);
app.use(securityMiddleware.requestSizeLimiter);

// CORS middleware
app.use(cors(securityMiddleware.corsConfig));

// Rate limiting (apply to all routes)
app.use(createRateLimiter(15 * 60 * 1000, 1000)); // 1000 requests per 15 minutes

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request sanitization and logging
app.use(securityMiddleware.sanitizeRequest);
app.use(securityMiddleware.requestLogger);

// Serve static files (for favicon and other assets)
app.use(express.static('public'));

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

// Favicon handlers (prevents 404 errors)
app.get("/favicon.ico", (req, res) => {
  // Redirect to SVG favicon or return 204 if not found
  res.redirect(301, '/favicon.svg');
});

app.get("/favicon.svg", (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
    <rect width="32" height="32" fill="#4F46E5"/>
    <text x="16" y="22" font-family="Arial, sans-serif" font-size="18" font-weight="bold" text-anchor="middle" fill="white">N</text>
  </svg>`;
  res.send(favicon);
});

// Health check endpoints (MUST be before routes)
app.get("/", (req, res) => {
  res.json({ 
    message: 'NexKirana Backend Server is running!',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  });
});

// Health check with database status
app.get("/health", async (req, res) => {
  try {
    const connection = await db.getConnection();
    await connection.execute('SELECT 1 as test');
    connection.release();
    
    res.json({ 
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString(),
      server: 'running'
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ 
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// API status endpoint
app.get("/api", (req, res) => {
  res.json({
    message: "NexKirana API is running",
    endpoints: {
      user: "/api/user",
      shopkeeper: "/api/shopkeeper", 
      admin: "/api/admin",
      orders: "/api/orders"
    },
    timestamp: new Date().toISOString()
  });
});

// Database status endpoint (connects to existing tables)
app.get("/api/db-status", async (req, res) => {
  try {
    // Check existing tables without modifying them
    const tables = ['admins', 'global_products', 'order_items', 'orders', 'products', 'shopkeepers', 'users'];
    const tableStatus = {};
    
    for (const table of tables) {
      try {
        const [rows] = await db.execute(`SELECT COUNT(*) as count FROM ${table}`);
        tableStatus[table] = {
          exists: true,
          records: rows[0].count
        };
      } catch (error) {
        tableStatus[table] = {
          exists: false,
          error: error.message
        };
      }
    }

    res.json({
      success: true,
      message: 'Connected to existing database successfully',
      tables: tableStatus,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Database status check failed:', error);
    res.status(500).json({
      success: false,
      message: 'Database status check failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Debug admin table structure - handle single admin
app.get("/api/debug-admin", async (req, res) => {
  try {
    // Get table structure
    const [tableInfo] = await db.execute("DESCRIBE admins");
    
    // Get the single admin data (without showing password)
    const [adminData] = await db.execute("SELECT * FROM admins LIMIT 1");
    
    // Remove password from response for security
    const safeAdminData = adminData.map(admin => {
      const safe = { ...admin };
      delete safe.password;
      delete safe.Password;
      delete safe.pass;
      delete safe.pwd;
      return safe;
    });
    
    res.json({
      success: true,
      message: 'Single admin table structure',
      tableStructure: tableInfo,
      adminData: safeAdminData[0] || null,
      adminCount: adminData.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Debug admin failed:', error);
    res.status(500).json({
      success: false,
      message: 'Debug admin failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Routes
app.use("/api/user", userrouter);
app.use("/api/shopkeeper", shopkeeperRouter);
app.use("/api/admin", adminRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/notifications", notificationRouter);

// 404 handler for unmatched routes (MUST be last)
app.use(securityMiddleware.notFoundHandler);

// Global error handler (MUST be last)
app.use(securityMiddleware.errorHandler);

// Server start
const PORT = config.PORT;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server successfully started on port ${PORT}`);
  console.log(`🌐 Server accessible at: http://0.0.0.0:${PORT}`);
  console.log('📋 Available endpoints:');
  console.log('  - GET  / (Health check)');
  console.log('  - GET  /health (Database status)');
  console.log('  - GET  /api (API info)');
  console.log('  - POST /api/admin/login');
  console.log('  - POST /api/user/signin');
  console.log('  - POST /api/shopkeeper/signin');
});

server.on('error', (error) => {
  console.error('❌ Server failed to start:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});
