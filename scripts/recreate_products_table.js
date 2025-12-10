import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function recreateTable() {
    let connection;
    try {
        const sslConfig = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT) || 4000,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: process.env.DB_NAME,
            ssl: sslConfig
        });

        console.log('Recreating products table...');

        // 1. Drop existing table
        console.log('1. Dropping existing products table...');
        await connection.query('DROP TABLE IF EXISTS products');

        // 2. Create new table with corect schema
        console.log('2. Creating new products table...');
        await connection.query(`
      CREATE TABLE products (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT NOT NULL,
        global_product_id BIGINT DEFAULT NULL,
        name VARCHAR(512) NOT NULL,
        description TEXT,
        category VARCHAR(512),
        price DOUBLE,
        stock BIGINT DEFAULT 0,
        image VARCHAR(2048),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_shop (shop_id),
        INDEX idx_global (global_product_id)
      )
    `);

        console.log('[SUCCESS] Products table recreated successfully.');

    } catch (error) {
        console.error('[ERROR] Failed to recreate table:', error);
    } finally {
        if (connection) await connection.end();
    }
}

recreateTable();
