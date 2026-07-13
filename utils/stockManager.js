import pool from "../config/db.js";

/**
 * Restore stock quantities when an order is cancelled
 * @param {number} orderId - The order ID to restore stock for
 * @param {string} cancelledBy - Who cancelled the order ('customer' or 'shopkeeper')
 * @param {string} reason - Cancellation reason (optional)
 * @returns {Promise<Object>} Result object with restoration details
 */
export const restoreStockForCancelledOrder = async (
  orderId,
  cancelledBy = "system",
  reason = null,
  connection = null
) => {
  const conn = connection || await pool.getConnection();
  const hasExternalTx = !!connection;

  try {
    console.log(
      `📦 Starting stock restoration for order ${orderId} (cancelled by: ${cancelledBy})`
    );
    console.log(`📦 Reason: ${reason || "No reason provided"}`);

    // Get order items to restore stock quantities
    const [orderItems] = await conn.query(
      `SELECT oi.product_id, oi.quantity, p.name as product_name, p.stock as current_stock
       FROM order_items oi 
       LEFT JOIN products p ON oi.product_id = p.id 
       WHERE oi.order_id = ?`,
      [orderId]
    );

    if (orderItems.length === 0) {
      console.log(`❌ No order items found for order ${orderId}`);
      if (!hasExternalTx) conn.release();
      return {
        success: false,
        message: "No order items found to restore stock",
        restoredItems: 0,
      };
    }

    console.log(`📋 Found ${orderItems.length} items to restore stock for:`);
    orderItems.forEach((item) => {
      console.log(
        `  - Product ${item.product_id} (${item.product_name}): restore ${item.quantity} units (current stock: ${item.current_stock})`
      );
    });

    // Check if this order has already been restored (only check actual restorations, not deductions)
    const [existingRestoration] = await conn.query(
      "SELECT id FROM stock_restoration_log WHERE order_id = ? AND total_quantity_restored > 0",
      [orderId]
    );

    if (existingRestoration.length > 0) {
      console.log(
        `⚠️ Stock for order ${orderId} has already been restored previously`
      );
      if (!hasExternalTx) conn.release();
      return {
        success: false,
        message: "Stock has already been restored for this order",
        restoredItems: 0,
        alreadyRestored: true,
      };
    }

    // Start transaction to ensure data consistency
    if (!hasExternalTx) {
      console.log(`🔄 Starting transaction for order ${orderId}`);
      await conn.query("START TRANSACTION");
    }

    const restoredItems = [];
    let totalRestoredQuantity = 0;

    try {
      // Restore stock quantities for each cancelled item
      for (const item of orderItems) {
        // Only restore stock if the product still exists
        if (item.current_stock !== null) {
          console.log(
            `📈 Restoring ${item.quantity} units to product ${item.product_id} (current stock: ${item.current_stock})`
          );

          const [updateResult] = await conn.query(
            "UPDATE products SET stock = stock + ? WHERE id = ?",
            [item.quantity, item.product_id]
          );

          if (updateResult.affectedRows > 0) {
            restoredItems.push({
              product_id: item.product_id,
              product_name: item.product_name,
              quantity_restored: item.quantity,
              previous_stock: item.current_stock,
              new_stock: item.current_stock + item.quantity,
            });
            totalRestoredQuantity += item.quantity;
            console.log(
              `✅ Successfully restored ${item.quantity} units to product ${item.product_id} (${item.product_name})`
            );
            console.log(
              `   Stock: ${item.current_stock} → ${item.current_stock + item.quantity}`
            );
          } else {
            console.log(
              `❌ Failed to restore stock for product ${item.product_id} - no rows affected`
            );
          }
        } else {
          console.log(
            `⚠️ Product ${item.product_id} no longer exists, skipping stock restoration`
          );
        }
      }

      // Log the stock restoration event
      console.log(`📝 Logging restoration event for order ${orderId}`);
      await conn.query(
        `INSERT INTO stock_restoration_log (order_id, cancelled_by, cancellation_reason, items_restored, total_quantity_restored, created_at) 
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [
          orderId,
          cancelledBy,
          reason,
          restoredItems.length,
          totalRestoredQuantity,
        ]
      );

      // Commit transaction
      if (!hasExternalTx) {
        console.log(`✅ Committing transaction for order ${orderId}`);
        await conn.query("COMMIT");
        conn.release();
      }

      console.log(
        `🎉 Stock restoration completed successfully for order ${orderId}:`
      );
      console.log(`   - Items restored: ${restoredItems.length}`);
      console.log(`   - Total quantity restored: ${totalRestoredQuantity}`);
      console.log(`   - Cancelled by: ${cancelledBy}`);

      return {
        success: true,
        message: "Stock restored successfully",
        orderId: orderId,
        restoredItems: restoredItems,
        totalItemsRestored: restoredItems.length,
        totalQuantityRestored: totalRestoredQuantity,
        cancelledBy: cancelledBy,
        reason: reason,
      };
    } catch (transactionError) {
      // Rollback transaction on error
      if (!hasExternalTx) {
        console.log(
          `🔄 Rolling back transaction for order ${orderId} due to error`
        );
        await conn.query("ROLLBACK");
        conn.release();
      }
      console.error(
        `❌ Stock restoration transaction failed for order ${orderId}:`,
        transactionError
      );
      throw transactionError;
    }
  } catch (error) {
    console.error(`❌ Stock restoration error for order ${orderId}:`, error);
    return {
      success: false,
      message: "Failed to restore stock",
      error: error.message,
      orderId: orderId,
    };
  }
};

/**
 * Check if stock restoration is needed for an order
 * @param {number} orderId - The order ID to check
 * @returns {Promise<boolean>} True if stock restoration is needed
 */
export const isStockRestorationNeeded = async (orderId) => {
  try {
    // Check if order exists and is in a state that requires stock restoration
    const [[order]] = await pool.query(
      "SELECT status FROM orders WHERE id = ?",
      [orderId]
    );

    if (!order) {
      return false;
    }

    // Stock restoration is needed for orders that are being cancelled
    // and were previously in a state where stock was deducted (Pending, Processing)
    const statusesRequiringRestoration = ["Pending", "Processing"];
    return statusesRequiringRestoration.includes(order.status);
  } catch (error) {
    console.error(
      `Error checking stock restoration need for order ${orderId}:`,
      error
    );
    return false;
  }
};

/**
 * Create the stock restoration log table if it doesn't exist
 * This should be run during database initialization
 */
export const createStockRestorationLogTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stock_restoration_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        cancelled_by VARCHAR(50) NOT NULL,
        cancellation_reason TEXT,
        items_restored INT DEFAULT 0,
        total_quantity_restored INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_order_id (order_id),
        INDEX idx_created_at (created_at)
      )
    `);
    console.log("✅ Stock restoration log table created/verified");
  } catch (error) {
    console.error("❌ Failed to create stock restoration log table:", error);
  }
};

/**
 * Get stock restoration history for an order
 * @param {number} orderId - The order ID to get history for
 * @returns {Promise<Array>} Array of restoration records
 */
export const getStockRestorationHistory = async (orderId) => {
  try {
    const [history] = await pool.query(
      `SELECT * FROM stock_restoration_log WHERE order_id = ? ORDER BY created_at DESC`,
      [orderId]
    );
    return history;
  } catch (error) {
    console.error(
      `Error getting stock restoration history for order ${orderId}:`,
      error
    );
    return [];
  }
};
