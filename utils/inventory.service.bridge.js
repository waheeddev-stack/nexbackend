/**
 * Inventory Service Bridge
 *
 * This module provides service layer functions that bridge inventory logic
 * with nexbackend's existing database and business logic.
 *
 * CRITICAL: Uses the shared mysql2 pool directly, no duplicate connections.
 */

import pool from "../config/db.js";

const DAY_MS = 24 * 60 * 60 * 1000; // 24 hours (86,400,000 ms)

export async function syncAvailableStockStatus(conn, productId, newStock) {
  const status = newStock === 0 ? "OUT OF STOCK" : "IN STOCK";
  await conn.execute(
    "UPDATE products SET available_stock = ? WHERE id = ? AND available_stock <> ?",
    [status, productId, "INVISIBLE"]
  );
}

export async function handleAutoRestock(productId, currentStock) {
  if (currentStock === 0) {
    try {
      const connection = await pool.getConnection();
      try {
        const restockAt = new Date(Date.now() + DAY_MS);
        await connection.execute(
          "UPDATE products SET restockAt = ? WHERE id = ?",
          [restockAt, productId]
        );
        console.log(
          `🕒 Restock scheduled for product ${productId} at ${restockAt}`
        );
        return true;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error("❌ Auto-restock scheduling failed:", error);
      return false;
    }
  }
  return false;
}

export async function deductStockForOrder(orderId, connection = null) {
  const useTransaction = connection !== null;
  const conn = connection || (await pool.getConnection());

  try {
    const [orderItems] = await conn.execute(
      "SELECT product_id, quantity FROM order_items WHERE order_id = ?",
      [orderId]
    );

    if (orderItems.length === 0) {
      console.log(`⚠️ No items found for order ${orderId}`);
      return { success: true, message: "No items to deduct" };
    }

    const deductions = [];
    for (const item of orderItems) {
      const [products] = await conn.execute(
        "SELECT id, name, stock FROM products WHERE id = ?",
        [item.product_id]
      );

      if (products.length === 0) {
        console.warn(`⚠️ Product ${item.product_id} not found`);
        continue;
      }

      const product = products[0];
      const newStock = Math.max(0, product.stock - item.quantity);

      await conn.execute("UPDATE products SET stock = ? WHERE id = ?", [
        newStock,
        item.product_id,
      ]);

      await syncAvailableStockStatus(conn, item.product_id, newStock);

      deductions.push({
        productId: item.product_id,
        productName: product.name,
        quantityDeducted: item.quantity,
        previousStock: product.stock,
        newStock: newStock,
      });

      await handleAutoRestock(item.product_id, newStock);

      console.log(
        `✅ Stock deducted: ${product.name} (${product.stock} → ${newStock})`
      );
    }

    if (!useTransaction) {
      conn.release();
    }

    return {
      success: true,
      message: "Stock deducted successfully",
      deductions,
    };
  } catch (error) {
    if (!useTransaction) {
      conn.release();
    }
    console.error("❌ Stock deduction failed:", error);
    throw error;
  }
}

export async function restoreStockForOrder(
  orderId,
  reason = "ORDER_CANCELLED",
  connection = null
) {
  const useTransaction = connection !== null;
  const conn = connection || (await pool.getConnection());

  try {
    const [existingRestore] = await conn.execute(
      `SELECT id FROM stock_restoration_log WHERE order_id = ? AND cancelled_by = 'SYSTEM_RESTORE' LIMIT 1`,
      [orderId]
    );

    if (existingRestore.length > 0) {
      console.log(`⚠️ Stock already restored for order ${orderId}`);
      if (!useTransaction) conn.release();
      return { success: true, message: "Stock already restored" };
    }

    const [orderItems] = await conn.execute(
      "SELECT product_id, quantity FROM order_items WHERE order_id = ?",
      [orderId]
    );

    if (orderItems.length === 0) {
      console.log(`⚠️ No items found for order ${orderId}`);
      if (!useTransaction) conn.release();
      return { success: true, message: "No items to restore" };
    }

    const restorations = [];
    for (const item of orderItems) {
      const [products] = await conn.execute(
        "SELECT id, name, stock FROM products WHERE id = ?",
        [item.product_id]
      );

      if (products.length === 0) {
        console.warn(`⚠️ Product ${item.product_id} not found`);
        continue;
      }

      const product = products[0];
      const newStock = product.stock + item.quantity;

      await conn.execute(
        "UPDATE products SET stock = ?, restockAt = NULL WHERE id = ?",
        [newStock, item.product_id]
      );

      await syncAvailableStockStatus(conn, item.product_id, newStock);

      restorations.push({
        productId: item.product_id,
        productName: product.name,
        quantityRestored: item.quantity,
        previousStock: product.stock,
        newStock: newStock,
      });

      console.log(
        `✅ Stock restored: ${product.name} (${product.stock} → ${newStock})`
      );
    }

    const totalQty = restorations.reduce(
      (sum, r) => sum + r.quantityRestored,
      0
    );
    await conn.execute(
      `INSERT INTO stock_restoration_log (order_id, cancelled_by, cancellation_reason, items_restored, total_quantity_restored, created_at) VALUES (?, 'SYSTEM_RESTORE', ?, ?, ?, NOW())`,
      [orderId, reason, restorations.length, totalQty]
    );

    if (!useTransaction) {
      conn.release();
    }

    return {
      success: true,
      message: "Stock restored successfully",
      restorations,
    };
  } catch (error) {
    if (!useTransaction) {
      conn.release();
    }
    console.error("❌ Stock restoration failed:", error);
    throw error;
  }
}

export async function getInventoryProduct(productId) {
  try {
    const connection = await pool.getConnection();
    try {
      const [products] = await connection.execute(
        "SELECT id, name, stock, baselineQty, restockAt FROM products WHERE id = ?",
        [productId]
      );
      return products.length > 0 ? products[0] : null;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("❌ Get inventory product failed:", error);
    return null;
  }
}

export async function createInventoryProduct(productData) {
  try {
    const connection = await pool.getConnection();
    try {
      const [result] = await connection.execute(
        "INSERT INTO products (name, stock, baselineQty, restockAt, createdAt, updatedAt) VALUES (?, ?, ?, NULL, NOW(), NOW())",
        [
          productData.name,
          productData.stock || 0,
          productData.baselineQty || productData.stock || 0,
        ]
      );

      const insertedId = result.insertId;
      const initialStock = productData.stock || 0;
      const initialStatus = initialStock === 0 ? "OUT OF STOCK" : "IN STOCK";
      await connection.execute(
        "UPDATE products SET available_stock = ? WHERE id = ? AND available_stock <> 'INVISIBLE'",
        [initialStatus, insertedId]
      );

      console.log(
        `✅ Inventory product created: ${productData.name} (ID: ${result.insertId})`
      );
      return { id: result.insertId, ...productData };
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("❌ Create inventory product failed:", error);
    throw error;
  }
}

export async function updateInventoryStock(
  productId,
  quantity,
  operation = "SET"
) {
  try {
    const connection = await pool.getConnection();
    try {
      const [products] = await connection.execute(
        "SELECT id, name, stock FROM products WHERE id = ?",
        [productId]
      );

      if (products.length === 0) {
        throw new Error(`Product ${productId} not found`);
      }

      const product = products[0];
      const previousStock = product.stock;
      let newStock = previousStock;

      if (operation === "ADD") {
        newStock = previousStock + quantity;
      } else if (operation === "SUBTRACT") {
        newStock = Math.max(0, previousStock - quantity);
      } else {
        newStock = quantity;
      }

      await connection.execute("UPDATE products SET stock = ? WHERE id = ?", [
        newStock,
        productId,
      ]);

      await syncAvailableStockStatus(connection, productId, newStock);

      await handleAutoRestock(productId, newStock);

      console.log(
        `✅ Inventory stock updated: ${product.name} (${previousStock} → ${newStock})`
      );

      return {
        success: true,
        product: {
          id: product.id,
          name: product.name,
          previousStock,
          newStock,
        },
      };
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("❌ Update inventory stock failed:", error);
    throw error;
  }
}
