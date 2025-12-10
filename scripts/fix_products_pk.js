import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function fixPrimaryKey() {
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

        console.log('Fixing products table keys step-by-step...');

        // 1. Delete rows where ID is NULL or 0
        console.log('1. Deleting corrupted products...');
        const [delResult] = await connection.query('DELETE FROM products WHERE id IS NULL OR id = 0');
        console.log(`   Deleted ${delResult.affectedRows} rows.`);

        // 2. Modify ID to NOT NULL first (required for PK)
        console.log('2. Setting id to NOT NULL...');
        await connection.query('ALTER TABLE products MODIFY id BIGINT NOT NULL');

        // 3. Add Primary Key
        console.log('3. Adding PRIMARY KEY...');
        await connection.query('ALTER TABLE products ADD PRIMARY KEY (id)');

        // 4. Add Auto Increment
        console.log('4. Adding AUTO_INCREMENT...');
        await connection.query('ALTER TABLE products MODIFY id BIGINT NOT NULL AUTO_INCREMENT');

        console.log('[SUCCESS] Products table schema fixed.');

    } catch (error) {
        console.error('[ERROR] Failed to fix schema:', error);
    } finally {
        if (connection) await connection.end();
    }
}

fixPrimaryKey();
