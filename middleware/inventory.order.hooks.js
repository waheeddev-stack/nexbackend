/**
 * Inventory Order Hooks
 * 
 * This module provides hooks that integrate inventory management with order lifecycle.
 * It automatically deducts/restores stock when orders are created/cancelled.
 * 
 * CRITICAL: Uses existing database transactions, no schema changes.
 */

import { deductStockForOrder, restoreStockForOrder } from '../utils/inventory.service.bridge.js';

/**
 * Hook: After order is successfully created
 * Deducts stock for all items in the order
 * 
 * Usage: Call this after order creation is committed
 */
export async function onOrderCreated(orderId, connection = null) {
  try {
    console.log(`🔗 Inventory hook: Order ${orderId} created, deducting stock...`);
    
    const result = await deductStockForOrder(orderId, connection);
    
    if (result.success) {
      console.log(`✅ Stock deducted for order ${orderId}:`, result.deductions?.length || 0, 'items');
    }
    
    return result;
  } catch (error) {
    console.error(`❌ Failed to deduct stock for order ${orderId}:`, error);
    // Don't throw - order is already created, log the error
    return { success: false, error: error.message };
  }
}

/**
 * Hook: After order is cancelled
 * Restores stock for all items in the order
 * 
 * Usage: Call this after order cancellation is committed
 */
export async function onOrderCancelled(orderId, reason = 'ORDER_CANCELLED', connection = null) {
  try {
    console.log(`🔗 Inventory hook: Order ${orderId} cancelled, restoring stock...`);
    
    const result = await restoreStockForOrder(orderId, reason, connection);
    
    if (result.success) {
      console.log(`✅ Stock restored for order ${orderId}:`, result.restorations?.length || 0, 'items');
    }
    
    return result;
  } catch (error) {
    console.error(`❌ Failed to restore stock for order ${orderId}:`, error);
    // Don't throw - order cancellation is already done, log the error
    return { success: false, error: error.message };
  }
}

/**
 * Hook: After order payment fails
 * Restores stock for all items in the order
 * 
 * Usage: Call this after payment failure is handled
 */
export async function onOrderPaymentFailed(orderId, connection = null) {
  return await onOrderCancelled(orderId, 'PAYMENT_FAILED', connection);
}

/**
 * Hook: After order times out (for pickup orders)
 * Restores stock for all items in the order
 * 
 * Usage: Call this after order timeout is handled
 */
export async function onOrderTimeout(orderId, connection = null) {
  return await onOrderCancelled(orderId, 'ORDER_TIMEOUT', connection);
}

/**
 * Hook: After order is rejected by shopkeeper
 * Restores stock for all items in the order
 * 
 * Usage: Call this after order rejection is handled
 */
export async function onOrderRejected(orderId, connection = null) {
  return await onOrderCancelled(orderId, 'ORDER_REJECTED', connection);
}

/**
 * Middleware: Attach inventory hooks to request object
 * This makes hooks available in route handlers
 */
export function attachInventoryHooks(req, _res, next) {
  req.inventoryHooks = {
    onOrderCreated,
    onOrderCancelled,
    onOrderPaymentFailed,
    onOrderTimeout,
    onOrderRejected
  };
  next();
}

/**
 * Helper: Check if stock is available for order items
 * Call this BEFORE creating an order to validate stock availability
 */
export async function validateStockAvailability(orderItems, connection = null) {
  const pool = (await import('../config/db.js')).default;
  const conn = connection || await pool.getConnection();
  const useTransaction = connection !== null;
  
  try {
    const unavailableItems = [];
    
    for (const item of orderItems) {
      const [products] = await conn.execute(
        'SELECT id, name, stock, baselineQty FROM products WHERE id = ?',
        [item.product_id || item.productId]
      );
      
      if (products.length === 0) {
        unavailableItems.push({
          productId: item.product_id || item.productId,
          reason: 'Product not found',
          requested: item.quantity
          // removed available field to hide exact stock count from customer
        });
        continue;
      }
      
      const product = products[0];

      // Check if product is live (baselineQty > 0)
      if (product.baselineQty <= 0) {
        unavailableItems.push({
          productId: product.id,
          productName: product.name,
          reason: 'Product no longer available',
          requested: item.quantity
          // removed available field to hide exact stock count from customer
        });
        continue;
      }

      if (product.stock < item.quantity) {
        unavailableItems.push({
          productId: product.id,
          productName: product.name,
          reason: 'Insufficient stock',
          requested: item.quantity
          // removed available field to hide exact stock count from customer
        });
      }
    }
    
    if (!useTransaction) {
      conn.release();
    }
    
    return {
      available: unavailableItems.length === 0,
      unavailableItems
    };
    
  } catch (error) {
    if (!useTransaction) {
      conn.release();
    }
    throw error;
  }
}
