import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function checkSchema() {
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

        console.log('Checking products table schema...');
        const [columns] = await connection.query('DESCRIBE products');
        console.log('Products table columns:');
        columns.forEach(col => {
            console.log(`- ${col.Field} (${col.Type}) Key:${col.Key} Extra:${col.Extra} Null:${col.Null}`);
        });

        console.log('\nIndexes:');
        const [indexes] = await connection.query('SHOW INDEX FROM products');
        indexes.forEach(idx => {
            console.log(`- ${idx.Key_name} (${idx.Column_name}) Unique:${!idx.Non_unique}`);
        });
        if (indexes.length === 0) console.log('(No indexes found)');

    } catch (error) {
        console.error('Error checking schema:', error);
    } finally {
        if (connection) await connection.end();
    }
}

checkSchema();
