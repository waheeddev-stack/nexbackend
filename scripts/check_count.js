import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function checkCount() {
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

        const [rows] = await connection.query('SELECT count(*) as c FROM products');
        console.log(`Row count: ${rows[0].c}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (connection) await connection.end();
    }
}

checkCount();
