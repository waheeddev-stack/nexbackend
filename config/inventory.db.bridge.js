/**
 * Inventory Database Bridge
 * 
 * This module bridges the inventorymng Sequelize models with nexbackend's mysql2 pool.
 * It reuses the SAME database connection without creating duplicate connections.
 * 
 * CRITICAL: This file does NOT modify any existing files or database schema.
 */

import { Sequelize } from 'sequelize';
import pool from './db.js';

let sequelizeInstance = null;
let inventoryModels = null;

/**
 * Initialize Sequelize instance using the existing mysql2 pool configuration
 * This ensures we use the SAME database without duplicate connections
 */
export async function initializeInventoryDB() {
  if (sequelizeInstance) {
    return { sequelize: sequelizeInstance, models: inventoryModels };
  }

  try {
    // Get a connection to verify database access
    const connection = await pool.getConnection();
    connection.release();

    // Create Sequelize instance with SAME database credentials
    sequelizeInstance = new Sequelize(
      process.env.DB_NAME,
      process.env.DB_USER,
      process.env.DB_PASS,
      {
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT) || 4000,
        dialect: 'mysql',
        logging: false,
        pool: {
          max: 5,
          min: 0,
          acquire: 30000,
          idle: 10000
        },
        dialectOptions: process.env.DB_SSL === 'true' ? {
          ssl: {
            rejectUnauthorized: false
          }
        } : {}
      }
    );

    // Test connection
    await sequelizeInstance.authenticate();
    console.log('✅ Inventory DB bridge: Sequelize connected to existing database');

    // Define inventory models (matching inventorymng structure)
    inventoryModels = defineInventoryModels(sequelizeInstance);

    // DO NOT SYNC - use existing tables only
    console.log('✅ Inventory models loaded (no schema changes)');

    return { sequelize: sequelizeInstance, models: inventoryModels };
  } catch (error) {
    console.error('❌ Inventory DB bridge initialization failed:', error);
    throw error;
  }
}

/**
 * Define inventory models matching inventorymng/models structure
 * These models map to existing tables without modifying schema
 */
function defineInventoryModels(sequelize) {
  const { DataTypes } = Sequelize;

  // Product model for inventory management
  const InventoryProduct = sequelize.define('InventoryProduct', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    stock: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    baselineQty: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'baselineQty'
    },
    restockAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'restockAt'
    }
  }, {
    tableName: 'products',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  });

  return {
    InventoryProduct
  };
}

/**
 * Get initialized inventory database instance
 */
export async function getInventoryDB() {
  if (!sequelizeInstance) {
    return await initializeInventoryDB();
  }
  return { sequelize: sequelizeInstance, models: inventoryModels };
}

/**
 * Close inventory database connection
 */
export async function closeInventoryDB() {
  if (sequelizeInstance) {
    await sequelizeInstance.close();
    sequelizeInstance = null;
    inventoryModels = null;
    console.log('✅ Inventory DB bridge closed');
  }
}
