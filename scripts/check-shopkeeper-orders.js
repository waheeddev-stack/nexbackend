import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
      rejectUnauthorized: true
    }
  });

  try {
    const [orders] = await pool.query(`
      SELECT 
        id, 
        shopkeeper_id,
        status,
        has_timer,
        pickup_code,
        deliveryType,
        order_type,
        created_at
      FROM orders 
      WHERE shopkeeper_id = 79
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    console.log('Recent orders for shopkeeper 79:');
    console.log(JSON.stringify(orders, null, 2));
    
    const pickupOrders = orders.filter(o => o.has_timer === 1);
    console.log(`\nPickup orders (has_timer=1): ${pickupOrders.length}`);
    console.log(`Delivery orders (has_timer=0 or NULL): ${orders.length - pickupOrders.length}`);
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
})();

