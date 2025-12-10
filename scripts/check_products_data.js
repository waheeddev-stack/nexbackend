import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function checkProducts() {
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

        console.log('Checking products table data...');

        // Check for null or funny IDs
        const [rows] = await connection.query('SELECT id, shop_id, name, created_at FROM products ORDER BY created_at DESC LIMIT 20');
        console.log('Recent 20 products:');
        rows.forEach(r => {
            console.log(`[${r.id}] Shop: ${r.shop_id} | Name: ${r.name}`);
        });

        const [invalid] = await connection.query('SELECT count(*) as c FROM products WHERE id IS NULL');
        if (invalid[0].c > 0) {
            console.log(`\n[WARNING] Found ${invalid[0].c} products with NULL id!`);
        } else {
            console.log('\n[OK] No products with NULL id found in DB.');
        }

    } catch (error) {
        console.error('Error checking products:', error);
    } finally {
        if (connection) await connection.end();
    }
}

checkProducts();
