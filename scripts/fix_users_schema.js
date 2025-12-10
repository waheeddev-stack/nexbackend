import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function fixUserSchema() {
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

        console.log('Fixing users table schema...');

        // Resize phone to VARCHAR(20)
        console.log('Modifying phone column to VARCHAR(20)...');
        await connection.query('ALTER TABLE users MODIFY phone VARCHAR(20)');

        console.log('[SUCCESS] Users table schema updated.');

    } catch (error) {
        console.error('[ERROR] Failed to fix schema:', error);
    } finally {
        if (connection) await connection.end();
    }
}

fixUserSchema();
