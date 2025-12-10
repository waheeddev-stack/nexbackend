import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function fixSchema() {
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

        console.log('Fixing products table schema...');

        // Resize description to TEXT and image to VARCHAR(2048)
        const query = `
      ALTER TABLE products 
      MODIFY description TEXT,
      MODIFY image VARCHAR(2048)
    `;

        await connection.query(query);
        console.log('[SUCCESS] Products table schema updated.');

    } catch (error) {
        console.error('[ERROR] Failed to fix schema:', error);
    } finally {
        if (connection) await connection.end();
    }
}

fixSchema();
