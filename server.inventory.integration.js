/**
 * Server Inventory Integration Loader
 * 
 * This module loads and initializes the inventory management integration.
 * Import and call this from server.js to activate inventory features.
 * 
 * CRITICAL: Does NOT modify server.js, call this explicitly to activate.
 */

import { initializeInventoryDB } from './config/inventory.db.bridge.js';
import { startRestockCron, getRestockCronStatus } from './cron/inventory.restock.cron.js';
import inventoryMgmtRouter from './routes/inventory.routes.wrapper.js';
import { attachInventoryHooks } from './middleware/inventory.order.hooks.js';

let isInitialized = false;

/**
 * Initialize inventory integration
 * Call this function in server.js after database connection is established
 */
export async function initializeInventoryIntegration() {
  if (isInitialized) {
    console.log('⚠️ Inventory integration already initialized');
    return;
  }
  
  try {
    console.log('🔧 Initializing inventory management integration...');
    
    // Step 1: Initialize database bridge
    await initializeInventoryDB();
    console.log('✅ Inventory database bridge initialized');
    
    // Step 2: Start restock cron job
    startRestockCron();
    const cronStatus = getRestockCronStatus();
    console.log(`✅ Restock cron started (${cronStatus.schedule})`);
    
    isInitialized = true;
    console.log('✅ Inventory integration initialized successfully');
    
  } catch (error) {
    console.error('❌ Failed to initialize inventory integration:', error);
    throw error;
  }
}

/**
 * Register inventory routes
 * Call this function in server.js to mount inventory management routes
 * 
 * @param {Express.Application} app - Express app instance
 */
export function registerInventoryRoutes(app) {
  // Mount inventory management routes
  app.use('/api/inventory-mgmt', inventoryMgmtRouter);
  console.log('✅ Inventory management routes registered at /api/inventory-mgmt');
}

/**
 * Register inventory middleware
 * Call this function in server.js to attach inventory hooks to requests
 * 
 * @param {Express.Application} app - Express app instance
 */
export function registerInventoryMiddleware(app) {
  // Attach inventory hooks to all requests
  app.use(attachInventoryHooks);
  console.log('✅ Inventory hooks middleware registered');
}

/**
 * Get integration status
 */
export function getInventoryIntegrationStatus() {
  return {
    initialized: isInitialized,
    cronStatus: getRestockCronStatus(),
    routes: {
      base: '/api/inventory-mgmt',
      endpoints: [
        'POST /api/inventory-mgmt/create-product',
        'POST /api/inventory-mgmt/buy',
        'GET /api/inventory-mgmt/product/:id',
        'GET /api/inventory-mgmt/products',
        'POST /api/inventory-mgmt/restock/:id',
        'GET /api/inventory-mgmt/low-stock'
      ]
    },
    hooks: [
      'onOrderCreated',
      'onOrderCancelled',
      'onOrderPaymentFailed',
      'onOrderTimeout',
      'onOrderRejected'
    ]
  };
}

/**
 * Export inventory hooks for use in order routes
 */
export { 
  onOrderCreated,
  onOrderCancelled,
  onOrderPaymentFailed,
  onOrderTimeout,
  onOrderRejected,
  validateStockAvailability
} from './middleware/inventory.order.hooks.js';

/**
 * Export inventory services for direct use
 */
export {
  deductStockForOrder,
  restoreStockForOrder,
  handleAutoRestock,
  getInventoryProduct,
  createInventoryProduct,
  updateInventoryStock
} from './utils/inventory.service.bridge.js';
