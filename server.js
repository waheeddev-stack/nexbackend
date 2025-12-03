import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";

import userrouter from "./routes/userRoute.js";
import shopkeeperRouter from "./routes/shopkeeperRoute.js";
import adminRouter from "./routes/adminRoute.js";
import ordersRouter from "./routes/ordersRoute.js";
import db from "./config/db.js";

dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET', 'DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingEnvVars.join(', '));
  process.exit(1);
}

if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 16) {
  console.error('❌ JWT_SECRET must be at least 16 characters long for security');
  process.exit(1);
}

if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  console.warn('⚠️ JWT_SECRET should be at least 32 characters for better security');
}

console.log('🚀 Starting NexKirana Backend Server...');
if (process.env.NODE_ENV !== 'production') {
  console.log('Environment Variables Check:');
  console.log('- NODE_ENV:', process.env.NODE_ENV);
  console.log('- PORT:', process.env.PORT);
  console.log('- DB_HOST:', process.env.DB_HOST ? 'SET' : 'NOT SET');
  console.log('- DB_SSL:', process.env.DB_SSL);
  console.log('- JWT_SECRET:', process.env.JWT_SECRET ? 'SET' : 'NOT SET');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? ["https://nexkirana-admin.vercel.app", "https://nexkirana.vercel.app", "exp://", "exps://"]
      : true, // Allow all origins in development
    methods: ["GET", "POST", "PATCH", "DELETE"],
    credentials: true
  },
});

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? (origin, callback) => {
        // Allow admin panel domains and mobile apps
        const allowedOrigins = ["https://nexkirana-admin.vercel.app", "https://nexkirana.vercel.app"];
        if (!origin || allowedOrigins.includes(origin) || origin.startsWith('exp://') || origin.startsWith('exps://')) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      }
    : true, // Allow all origins in development
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "PUT"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.removeHeader('X-Powered-By');
  next();
});

// Request logging middleware (always enabled for debugging)
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`📡 ${timestamp} - ${req.method} ${req.path}`);
  console.log(`📡 Headers:`, req.headers);
  console.log(`📡 Query:`, req.query);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`📡 Body:`, req.body);
  }
  next();
});

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

// 404 handler for unmatched routes (MUST be last)
app.use((req, res, next) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method,
    availableRoutes: [
      'GET /',
      'GET /health',
      'GET /api',
      'POST /api/user/signin',
      'POST /api/user/signup',
      'POST /api/shopkeeper/signin',
      'POST /api/admin/login'
    ],
    timestamp: new Date().toISOString()
  });
});

// Global error handler (MUST be last)
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// Server start
const PORT = process.env.PORT || 5000;

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
