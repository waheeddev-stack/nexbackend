/**
 * Inventory Database Bridge
 *
 * This module provides direct access to the shared mysql2 pool for inventory operations.
 * It eliminates the duplicate Sequelize instance and uses the existing database connection.
 *
 * CRITICAL: This file uses the SAME database connection pool as the rest of the backend.
 */

import pool from "./db.js";

/**
 * Get a connection from the shared pool
 * Always release the connection when done
 */
export async function getConnection() {
  return await pool.getConnection();
}

/**
 * Execute a query using the shared pool
 */
export async function executeQuery(sql, params = []) {
  const connection = await pool.getConnection();
  try {
    const [results] = await connection.execute(sql, params);
    return results;
  } finally {
    connection.release();
  }
}

/**
 * Execute a query within an existing transaction
 */
export async function executeQueryInTransaction(connection, sql, params = []) {
  const [results] = await connection.execute(sql, params);
  return results;
}

/**
 * Initialize inventory database (no-op since we use shared pool)
 */
export async function initializeInventoryDB() {
  try {
    // Test connection to verify database access
    const connection = await pool.getConnection();
    connection.release();
    console.log("✅ Inventory DB bridge: Using shared mysql2 pool");
    return { success: true };
  } catch (error) {
    console.error("❌ Inventory DB bridge initialization failed:", error);
    throw error;
  }
}

/**
 * Get initialized inventory database instance (returns pool reference)
 */
export async function getInventoryDB() {
  return { pool };
}

/**
 * Close inventory database connection (no-op since pool is managed globally)
 */
export async function closeInventoryDB() {
  console.log("✅ Inventory DB bridge: Pool remains active (managed globally)");
}
