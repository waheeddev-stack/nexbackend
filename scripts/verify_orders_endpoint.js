import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

dotenv.config();

const API_URL = `http://127.0.0.1:5001/api/shopkeeper`;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

async function verifyOrdersAndInsights() {
    let connection;
    try {
        console.log('🔄 Connecting to DB...');
        const sslConfig = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT) || 4000,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: process.env.DB_NAME,
            ssl: sslConfig
        });

        // 1. Setup Test Data (Shopkeeper + Product + User + Order)
        const testPhone = '9999999999';
        const testSku = 'TEST-SKU-orders';

        // Create Shopkeeper
        console.log('👤 Creating Test Shopkeeper...');
        const [skRes] = await connection.query(`INSERT INTO shopkeepers (phone, password) VALUES (?, 'hashed') ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`, [testPhone]);
        const shopId = skRes.insertId;

        // Create Product
        console.log('📦 Creating Test Product...');
        // Ensure we use the correct columns verified earlier
        const [prodRes] = await connection.query(`INSERT INTO products (shop_id, name, price, stock, description) VALUES (?, ?, 100, 10, 'Test Product')`, [shopId, testSku]);
        const prodId = prodRes.insertId;

        // Create User (Customer)
        console.log('🧑 Creating Test Customer...');
        const [userRes] = await connection.query(`INSERT INTO users (phone, name) VALUES ('8888888888', 'Test Customer') ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`);
        const userId = userRes.insertId;

        // Create Order
        console.log('🛒 Creating Test Order...');
        const [orderRes] = await connection.query(`INSERT INTO orders (user_id, shopkeeper_id, total_amount, status) VALUES (?, ?, 200, 'Delivered')`, [userId, shopId]);
        const orderId = orderRes.insertId;

        // Create Order Items
        await connection.query(`INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, 2, 100)`, [orderId, prodId]);

        // 2. Generate Token
        const token = jwt.sign({ id: shopId, role: 'shopkeeper' }, JWT_SECRET, { expiresIn: '1h' });

        // 3. Call API Endpoint
        console.log(`🌍 Fetching orders from ${API_URL}/orders...`);
        const res = await fetch(`${API_URL}/orders`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error(`API returned ${res.status}: ${await res.text()}`);

        const data = await res.json();
        console.log('📥 API Response received.');

        // 4. Verify Data Structure (Insights Simulation)
        if (data.success && Array.isArray(data.orders)) {
            const orders = data.orders;
            console.log(`✅ Received ${orders.length} orders.`);

            const testOrder = orders.find(o => o.order_id === orderId);
            if (testOrder) {
                console.log('✅ Found created test order.');

                // Verify Items (Critical for "Top Selling" insight)
                if (testOrder.items && testOrder.items.length > 0) {
                    console.log('✅ Order items structure present.');
                    console.log('   Item:', testOrder.items[0]);

                    // Simulate Dashboard Calculation
                    const delivered = orders.filter(o => o.status === 'Delivered');
                    const totalSales = delivered.reduce((sum, o) => sum + Number(o.total_amount), 0);

                    console.log('\n📊 Insights Simulation:');
                    console.log(`   Total Sales: ${totalSales} (Expected >= 200)`);
                    console.log(`   Delivered Orders: ${delivered.length} (Expected >= 1)`);

                    if (totalSales >= 200) {
                        console.log('✅ Insights calculation logic valid.');
                    } else {
                        console.error('❌ Insight calculation data missing/mismatch.');
                    }

                } else {
                    console.error('❌ Missing items in order response (Critical for top products insight).');
                }
            } else {
                console.error('❌ Could not find the test order in response.');
            }
        } else {
            console.error('❌ Invalid response structure:', data);
        }

        // Cleanup
        console.log('\n🧹 Cleaning up test data...');
        await connection.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);
        await connection.query('DELETE FROM orders WHERE id = ?', [orderId]);
        await connection.query('DELETE FROM products WHERE id = ?', [prodId]);
        await connection.query('DELETE FROM shopkeepers WHERE id = ?', [shopId]);
        await connection.query('DELETE FROM users WHERE id = ?', [userId]);

    } catch (err) {
        console.error('❌ Verification failed:', err);
    } finally {
        if (connection) await connection.end();
    }
}

verifyOrdersAndInsights();
