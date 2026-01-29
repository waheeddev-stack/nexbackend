#!/usr/bin/env node

/**
 * Debug script to identify stock quantity issues
 * This script will help identify why stock quantities are still decreasing after cancellation
 */

import pool from "../config/db.js";

async function debugStockIssues() {
  try {
    console.log("🔍 Debugging Stock Issues");
    console.log("========================");
    
    // 1. Check for recent orders and their status
    console.log("\n📋 Recent Orders (Last 10):");
    const [recentOrders] = await pool.query(`
      SELECT o.id, o.status, o.created_at, o.user_id, o.shopkeeper_id,
             COUNT(oi.id) as item_count,
             SUM(oi.quantity) as total_quantity
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY o.id, o.status, o.created_at, o.user_id, o.shopkeeper_id
      ORDER BY o.created_at DESC
      LIMIT 10
    `);
    
    recentOrders.forEach(order => {
      console.log(`  Order ${order.id}: ${order.status} (${order.created_at})`);
      console.log(`    Items: ${order.item_count}, Total Qty: ${order.total_quantity}`);
    });
    
    // 2. Check for cancelled orders and their restoration status
    console.log("\n🚫 Cancelled Orders and Restoration Status:");
    const [cancelledOrders] = await pool.query(`
      SELECT o.id, o.created_at, o.status,
             COUNT(oi.id) as item_count,
             SUM(oi.quantity) as total_quantity,
             srl.items_restored,
             srl.total_quantity_restored,
             srl.cancelled_by,
             srl.created_at as restoration_time
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN stock_restoration_log srl ON o.id = srl.order_id
      WHERE o.status = 'Cancelled'
      GROUP BY o.id, o.created_at, o.status, srl.items_restored, srl.total_quantity_restored, srl.cancelled_by, srl.created_at
      ORDER BY o.created_at DESC
      LIMIT 5
    `);
    
    cancelledOrders.forEach(order => {
      console.log(`  Order ${order.id}: Cancelled (${order.created_at})`);
      console.log(`    Original: ${order.item_count} items, ${order.total_quantity} quantity`);
      if (order.items_restored !== null) {
        console.log(`    ✅ Restored: ${order.items_restored} items, ${order.total_quantity_restored} quantity`);
        console.log(`    Restored by: ${order.cancelled_by} at ${order.restoration_time}`);
      } else {
        console.log(`    ❌ NO RESTORATION RECORD FOUND!`);
      }
    });
    
    // 3. Check for products with suspicious stock levels
    console.log("\n📦 Products with Low/Zero Stock:");
    const [lowStockProducts] = await pool.query(`
      SELECT p.id, p.name, p.stock, p.shop_id,
             COUNT(oi.id) as times_ordered,
             SUM(oi.quantity) as total_ordered
      FROM products p
      LEFT JOIN order_items oi ON p.id = oi.product_id
      WHERE p.stock <= 5
      GROUP BY p.id
      ORDER BY p.stock ASC, total_ordered DESC
      LIMIT 10
    `);
    
    lowStockProducts.forEach(product => {
      console.log(`  Product ${product.id} (${product.name}): Stock = ${product.stock}`);
      console.log(`    Shop: ${product.shop_id}, Ordered ${product.times_ordered} times, Total qty: ${product.total_ordered || 0}`);
    });
    
    // 4. Check for recent stock restoration log entries
    console.log("\n📝 Recent Stock Restoration Log (Last 10):");
    const [recentRestorations] = await pool.query(`
      SELECT * FROM stock_restoration_log 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    
    if (recentRestorations.length === 0) {
      console.log("  ❌ NO RESTORATION LOG ENTRIES FOUND!");
      console.log("  This suggests the stock restoration function is not being called or the table doesn't exist.");
    } else {
      recentRestorations.forEach(log => {
        console.log(`  ${log.created_at}: Order ${log.order_id} by ${log.cancelled_by}`);
        console.log(`    Items: ${log.items_restored}, Quantity: ${log.total_quantity_restored}`);
        if (log.cancellation_reason) {
          console.log(`    Reason: ${log.cancellation_reason}`);
        }
      });
    }
    
    // 5. Check if stock_restoration_log table exists
    console.log("\n🗄️ Checking Database Tables:");
    try {
      const [tables] = await pool.query("SHOW TABLES LIKE 'stock_restoration_log'");
      if (tables.length === 0) {
        console.log("  ❌ stock_restoration_log table DOES NOT EXIST!");
        console.log("  💡 Run the init-stock-restoration-table.js script to create it");
      } else {
        console.log("  ✅ stock_restoration_log table exists");
      }
    } catch (error) {
      console.log("  ❌ Error checking table existence:", error.message);
    }
    
    // 6. Check for any orders that were cancelled but stock wasn't restored
    console.log("\n🔍 Orders Cancelled Without Stock Restoration:");
    const [unrestoredOrders] = await pool.query(`
      SELECT o.id, o.created_at, o.status,
             COUNT(oi.id) as item_count,
             SUM(oi.quantity) as total_quantity
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN stock_restoration_log srl ON o.id = srl.order_id
      WHERE o.status = 'Cancelled' AND srl.id IS NULL
      GROUP BY o.id, o.created_at, o.status
      ORDER BY o.created_at DESC
      LIMIT 5
    `);
    
    if (unrestoredOrders.length === 0) {
      console.log("  ✅ All cancelled orders have restoration records");
    } else {
      console.log("  ❌ Found cancelled orders without restoration:");
      unrestoredOrders.forEach(order => {
        console.log(`    Order ${order.id}: ${order.item_count} items, ${order.total_quantity} quantity`);
      });
    }
    
    console.log("\n🏁 Debug analysis completed");
    
  } catch (error) {
    console.error("❌ Debug failed:", error);
  } finally {
    await pool.end();
  }
}

// Run the debug
debugStockIssues();