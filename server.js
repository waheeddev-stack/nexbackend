import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

import userrouter from "./routes/userRoute.js";
import shopkeeperRouter from "./routes/shopkeeperRoute.js";
import adminRouter from "./routes/adminRoute.js";
import ordersRouter from "./routes/ordersRoute.js";
import notificationRouter from "./routes/notificationRoute.js";
import authRouter from "./routes/authRoute.js";
import googleAuthRouter from "./routes/googleAuthRoute.js";
import inventoryRouter from "./routes/inventoryRoute.js";
import passwordResetRouter from "./routes/passwordResetRoute.js";
import deepLinkRedirectRouter from "./routes/deepLinkRedirect.js";
import serviceStatusRouter from "./routes/serviceStatusRoute.js";
import db from "./config/db.js";

// Import inventory management integration components
import { initializeInventoryDB } from './config/inventory.db.bridge.js';
import { startRestockCron, getRestockCronStatus } from './cron/inventory.restock.cron.js';
import inventoryMgmtRouter from './routes/inventory.routes.wrapper.js';
import { attachInventoryHooks } from './middleware/inventory.order.hooks.js';

// Import stock manager for table initialization
import { createStockRestorationLogTable } from "./utils/stockManager.js";

// Import subscription status cron job
import { startSubscriptionStatusCron } from "./cron/subscription.status.cron.js";
import { startTimerCleanupCron, getTimerCleanupCronStatus } from "./cron/timer.cleanup.cron.js";

// Import timer table initialization
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);
      
      if (config.NODE_ENV === 'production') {
        const allowedOrigins = config.corsOrigins;
        
        // Check if origin is allowed or is an Expo app
        if (allowedOrigins.includes(origin) || 
            origin.startsWith('exp://') || 
            origin.startsWith('exps://') ||
            origin.startsWith('http://') ||
            origin.startsWith('https://')) {
          callback(null, true);
        } else {
          callback(null, true); // Allow all in case of websocket connection issues
        }
      } else {
        // Allow all origins in development
        callback(null, true);
      }
    },
    credentials: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['*'],
    transports: ['websocket', 'polling']
  },
  // Add these options for better websocket support
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  maxHttpBufferSize: 1e6,
  allowEIO3: true, // Allow Engine.IO v3 clients
  transports: ['websocket', 'polling']
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

// Register inventory middleware (attaches hooks to requests)
app.use(attachInventoryHooks);

// Socket.IO: handle connections and room joins
io.on("connection", (socket) => {
  console.log("📡 Socket connected:", socket.id);

  // Join as shopkeeper
  socket.on("joinShop", (shopkeeper_id) => {
    if (!shopkeeper_id) {
      console.log(`📡 Socket ${socket.id}: joinShop called with empty shopkeeper_id`);
      return;
    }
    // Convert to number for consistent room naming
    const numericShopkeeperId = Number(shopkeeper_id);
    const room = `shop_${numericShopkeeperId}`;
    socket.join(room);
    socket.shopkeeper_id = numericShopkeeperId;
    console.log(`📡 Socket ${socket.id} joined ${room} (shopkeeper_id: ${numericShopkeeperId})`);
    
    // Notify admin of shopkeeper connection
    socket.to("admin").emit("shopkeeperOnline", { shopkeeper_id: numericShopkeeperId, socket_id: socket.id });
  });

  // Join as customer
  socket.on("joinCustomer", (user_id) => {
    if (!user_id) {
      console.log(`📡 Socket ${socket.id}: joinCustomer called with empty user_id`);
      return;
    }
    // Convert to number for consistent room naming
    const numericUserId = Number(user_id);
    const room = `customer_${numericUserId}`;
    socket.join(room);
    socket.user_id = numericUserId;
    console.log(`📡 Socket ${socket.id} joined ${room} (user_id: ${numericUserId})`);
    
    // Notify admin of customer connection
    socket.to("admin").emit("customerOnline", { user_id: numericUserId, socket_id: socket.id });
  });

  // Join as admin
  socket.on("joinAdmin", (admin_id) => {
    if (!admin_id) {
      console.log(`📡 Socket ${socket.id}: joinAdmin called with empty admin_id`);
      return;
    }
    socket.join("admin");
    socket.admin_id = admin_id;
    console.log(`📡 Socket ${socket.id} joined admin room (admin_id: ${admin_id})`);
  });

  // Handle order status updates from shopkeeper
  socket.on("updateOrderStatus", (data) => {
    const { orderId, status, shopkeeperId, customerId } = data;
    console.log(`📡 Socket: Received updateOrderStatus - orderId: ${orderId}, status: ${status}`);
    
    // Broadcast to admin
    socket.to("admin").emit("orderStatusUpdate", { orderId, status, shopkeeperId });
    
    // Broadcast to specific customer if available
    if (customerId) {
      const customerRoom = `customer_${Number(customerId)}`;
      console.log(`📡 Socket: Broadcasting to ${customerRoom}`);
      socket.to(customerRoom).emit("orderStatusUpdate", { orderId, status });
    }
  });

  // Handle customer notifications
  socket.on("notifyCustomer", (data) => {
    const { customerId, message, shopkeeperId } = data;
    console.log(`📡 Socket: Notifying customer ${customerId} from shopkeeper ${shopkeeperId}`);
    const customerRoom = `customer_${Number(customerId)}`;
    socket.to(customerRoom).emit("notification", {
      type: "shopkeeper_message",
      message,
      shopkeeperId,
      timestamp: new Date().toISOString(),
    });
  });

  // Handle admin broadcasts
  socket.on("broadcastToShopkeepers", (message) => {
    if (socket.admin_id) {
      console.log(`📡 Socket: Admin broadcasting to all shopkeepers`);
      io.emit("adminBroadcast", {
        type: "shopkeeper",
        message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  socket.on("broadcastToCustomers", (message) => {
    if (socket.admin_id) {
      console.log(`📡 Socket: Admin broadcasting to all customers`);
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
      console.log(`📡 Socket: Admin notifying shopkeeper ${shopkeeperId}`);
      const shopRoom = `shop_${Number(shopkeeperId)}`;
      socket.to(shopRoom).emit("adminNotification", {
        message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Handle room leaving
  socket.on("leaveRoom", (room) => {
    if (!room) return;
    socket.leave(room);
    console.log(`📡 Socket ${socket.id} left ${room}`);
  });

  // Handle disconnection
  socket.on("disconnect", (reason) => {
    console.log(`📡 Socket disconnected: ${socket.id}, reason: ${reason}`);
    
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
      socketio: {
        connected: io.engine.clientsCount || 0,
        status: 'running'
      },
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

// Socket.IO status endpoint
app.get("/api/socket-status", (req, res) => {
  res.json({
    success: true,
    socketio: {
      connected_clients: io.engine.clientsCount || 0,
      status: 'running',
      transports: ['websocket', 'polling']
    },
    timestamp: new Date().toISOString()
  });
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
app.use("/api/auth", authRouter);
app.use("/api/auth", googleAuthRouter); // Google OAuth routes
app.use("/api/password-reset", passwordResetRouter); // Password reset routes
app.use("/reset-password", deepLinkRedirectRouter); // Deep link redirect for emails
app.use("/api/service", serviceStatusRouter); // Service status endpoint (public)
app.use("/api/user", userrouter);
app.use("/api/shopkeeper", shopkeeperRouter);
app.use("/api/admin", adminRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/inventory", inventoryRouter);

// Register inventory management routes
app.use('/api/inventory-mgmt', inventoryMgmtRouter);

// 404 handler for unmatched routes (MUST be last)
app.use(securityMiddleware.notFoundHandler);

// Global error handler (MUST be last)
app.use(securityMiddleware.errorHandler);

// Server start
const PORT = config.PORT;

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`✅ Server successfully started on port ${PORT}`);
  console.log(`🌐 Server accessible at: http://0.0.0.0:${PORT}`);
  
  // Initialize stock restoration table
  try {
    await createStockRestorationLogTable();
    console.log('✅ Stock restoration table initialized');
  } catch (error) {
    console.error('❌ Failed to initialize stock restoration table:', error);
  }
  
  // Initialize inventory integration
  try {
    console.log('🔧 Initializing inventory management integration...');
    
    // Initialize database bridge
    await initializeInventoryDB();
    console.log('✅ Inventory database bridge initialized');
    
    // Start restock cron job
    startRestockCron();
    const cronStatus = getRestockCronStatus();
    console.log(`✅ Restock cron started (${cronStatus.schedule})`);
    console.log('✅ Inventory management integration activated');
  } catch (error) {
    console.error('❌ Failed to initialize inventory integration:', error);
  }
  
  // Initialize timer tables
  try {
    console.log('🔧 Initializing timer tables...');
    const schemaPath = join(__dirname, 'schema', 'order_timers.sql');
    
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      const statements = schema
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

      for (const statement of statements) {
        try {
          await db.query(statement);
        } catch (error) {
          if (!error.message.includes('already exists') && 
              !error.message.includes('Duplicate column name') &&
              !error.message.includes('Duplicate key name')) {
            console.warn('Timer table setup warning:', error.message);
          }
        }
      }
      console.log('✅ Timer tables initialized');
    } else {
      console.warn('⚠️ Timer schema file not found, skipping timer table initialization');
    }
  } catch (error) {
    console.error('❌ Failed to initialize timer tables:', error);
  }
  
  // Start subscription status cron job
  try {
    startSubscriptionStatusCron();
    console.log('✅ Subscription status monitoring activated');
  } catch (error) {
    console.error('❌ Failed to start subscription status cron:', error);
  }
  
  // Start timer cleanup cron job
  try {
    startTimerCleanupCron(undefined, io);
    const timerCronStatus = getTimerCleanupCronStatus();
    console.log(`✅ Timer cleanup cron started (interval ${timerCronStatus.intervalMs}ms)`);
  } catch (error) {
    console.error('❌ Failed to start timer cleanup cron:', error);
  }
  
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
