/**
 * Inventory Service Bridge
 * 
 * This module provides service layer functions that bridge inventorymng logic
 * with nexbackend's existing database and business logic.
 * 
 * CRITICAL: Reuses existing database connection, no schema changes.
 */

import { getInventoryDB } from '../config/inventory.db.bridge.js';
import pool from '../config/db.js';

/**
 * Handle auto-restock logic (from inventorymng/utils/autoRestock.js)
 * Schedules restock when product stock reaches 0
 */
const DAY_MS = 10000; // 10 seconds for testing (original: 24 * 60 * 60 * 1000)

export async function handleAutoRestock(productId, currentStock) {
  if (currentStock === 0) {
    try {
      const { models } = await getInventoryDB();
      const product = await models.InventoryProduct.findByPk(productId);
      
      if (product && !product.restockAt) {
        product.restockAt = new Date(Date.now() + DAY_MS);
        await product.save();
        
        console.log(`🕒 Restock scheduled for product ${productId} at ${product.restockAt}`);
        return true;
      }
    } catch (error) {
      console.error('❌ Auto-restock scheduling failed:', error);
      return false;
    }
  }
  return false;
}

/**
 * Deduct stock when order is confirmed
 * This hooks into the order lifecycle
 */
export async function deductStockForOrder(orderId, connection = null) {
  const useTransaction = connection !== null;
  const conn = connection || await pool.getConnection();
  
  try {
    // Get order items
    const [orderItems] = await conn.execute(
      'SELECT product_id, quantity FROM order_items WHERE order_id = ?',
      [orderId]
    );
    
    if (orderItems.length === 0) {
      console.log(`⚠️ No items found for order ${orderId}`);
      return { success: true, message: 'No items to deduct' };
    }
    
    // Deduct stock for each product
    const deductions = [];
    for (const item of orderItems) {
      const [products] = await conn.execute(
        'SELECT id, name, stock FROM products WHERE id = ?',
        [item.product_id]
      );
      
      if (products.length === 0) {
        console.warn(`⚠️ Product ${item.product_id} not found`);
        continue;
      }
      
      const product = products[0];
      const newStock = Math.max(0, product.stock - item.quantity);
      
      // Update stock
      await conn.execute(
        'UPDATE products SET stock = ? WHERE id = ?',
        [newStock, item.product_id]
      );
      
      deductions.push({
        productId: item.product_id,
        productName: product.name,
        quantityDeducted: item.quantity,
        previousStock: product.stock,
        newStock: newStock
      });
      
      // Schedule auto-restock if stock is 0
      await handleAutoRestock(item.product_id, newStock);
      
      console.log(`✅ Stock deducted: ${product.name} (${product.stock} → ${newStock})`);
    }
    
    // Log stock deduction
    const totalQty = deductions.reduce((sum, d) => sum + d.quantityDeducted, 0);
    await conn.execute(
      `INSERT INTO stock_restoration_log (order_id, cancelled_by, cancellation_reason, items_restored, total_quantity_restored, created_at) 
       VALUES (?, 'SYSTEM_DEDUCT', ?, ?, ?, NOW())`,
      [orderId, 'Stock deducted for order placement', deductions.length, -totalQty]
    );
    
    if (!useTransaction) {
      conn.release();
    }
    
    return { 
      success: true, 
      message: 'Stock deducted successfully',
      deductions 
    };
    
  } catch (error) {
    if (!useTransaction) {
      conn.release();
    }
    console.error('❌ Stock deduction failed:', error);
    throw error;
  }
}

/**
 * Restore stock when order is cancelled or fails
 */
export async function restoreStockForOrder(orderId, reason = 'ORDER_CANCELLED', connection = null) {
  const useTransaction = connection !== null;
  const conn = connection || await pool.getConnection();
  
  try {
    // Check if stock was already restored
    const [existingRestore] = await conn.execute(
      `SELECT id FROM stock_restoration_log 
       WHERE order_id = ? AND cancelled_by = 'SYSTEM_RESTORE' 
       LIMIT 1`,
      [orderId]
    );
    
    if (existingRestore.length > 0) {
      console.log(`⚠️ Stock already restored for order ${orderId}`);
      if (!useTransaction) conn.release();
      return { success: true, message: 'Stock already restored' };
    }
    
    // Get order items
    const [orderItems] = await conn.execute(
      'SELECT product_id, quantity FROM order_items WHERE order_id = ?',
      [orderId]
    );
    
    if (orderItems.length === 0) {
      console.log(`⚠️ No items found for order ${orderId}`);
      if (!useTransaction) conn.release();
      return { success: true, message: 'No items to restore' };
    }
    
    // Restore stock for each product
    const restorations = [];
    for (const item of orderItems) {
      const [products] = await conn.execute(
        'SELECT id, name, stock FROM products WHERE id = ?',
        [item.product_id]
      );
      
      if (products.length === 0) {
        console.warn(`⚠️ Product ${item.product_id} not found`);
        continue;
      }
      
      const product = products[0];
      const newStock = product.stock + item.quantity;
      
      // Update stock
      await conn.execute(
        'UPDATE products SET stock = ? WHERE id = ?',
        [newStock, item.product_id]
      );
      
      restorations.push({
        productId: item.product_id,
        productName: product.name,
        quantityRestored: item.quantity,
        previousStock: product.stock,
        newStock: newStock
      });
      
      console.log(`✅ Stock restored: ${product.name} (${product.stock} → ${newStock})`);
    }
    
    // Log stock restoration
    const totalQty = restorations.reduce((sum, r) => sum + r.quantityRestored, 0);
    await conn.execute(
      `INSERT INTO stock_restoration_log (order_id, cancelled_by, cancellation_reason, items_restored, total_quantity_restored, created_at) 
       VALUES (?, 'SYSTEM_RESTORE', ?, ?, ?, NOW())`,
      [orderId, reason, restorations.length, totalQty]
    );
    
    if (!useTransaction) {
      conn.release();
    }
    
    return { 
      success: true, 
      message: 'Stock restored successfully',
      restorations 
    };
    
  } catch (error) {
    if (!useTransaction) {
      conn.release();
    }
    console.error('❌ Stock restoration failed:', error);
    throw error;
  }
}

/**
 * Get inventory product details
 */
export async function getInventoryProduct(productId) {
  try {
    const { models } = await getInventoryDB();
    const product = await models.InventoryProduct.findByPk(productId);
    return product;
  } catch (error) {
    console.error('❌ Get inventory product failed:', error);
    return null;
  }
}

/**
 * Create inventory product entry
 */
export async function createInventoryProduct(productData) {
  try {
    const { models } = await getInventoryDB();
    const product = await models.InventoryProduct.create({
      name: productData.name,
      stock: productData.stock || 0,
      baselineQty: productData.baselineQty || productData.stock || 0,
      restockAt: null
    });
    
    console.log(`✅ Inventory product created: ${product.name} (ID: ${product.id})`);
    return product;
  } catch (error) {
    console.error('❌ Create inventory product failed:', error);
    throw error;
  }
}

/**
 * Update inventory product stock
 */
export async function updateInventoryStock(productId, quantity, operation = 'SET') {
  try {
    const { models } = await getInventoryDB();
    const product = await models.InventoryProduct.findByPk(productId);
    
    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }
    
    const previousStock = product.stock;
    
    if (operation === 'ADD') {
      product.stock += quantity;
    } else if (operation === 'SUBTRACT') {
      product.stock = Math.max(0, product.stock - quantity);
    } else {
      product.stock = quantity;
    }
    
    await product.save();
    
    // Handle auto-restock if needed
    await handleAutoRestock(productId, product.stock);
    
    console.log(`✅ Inventory stock updated: ${product.name} (${previousStock} → ${product.stock})`);
    
    return {
      success: true,
      product: {
        id: product.id,
        name: product.name,
        previousStock,
        newStock: product.stock
      }
    };
  } catch (error) {
    console.error('❌ Update inventory stock failed:', error);
    throw error;
  }
}
