import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function checkUserSchema() {
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

        console.log('Checking users table schema...');
        const [columns] = await connection.query('DESCRIBE users');
        console.log('Users table columns:');
        columns.forEach(col => {
            console.log(`- ${col.Field} (${col.Type})`);
        });

    } catch (error) {
        console.error('Error checking schema:', error);
    } finally {
        if (connection) await connection.end();
    }
}

checkUserSchema();
