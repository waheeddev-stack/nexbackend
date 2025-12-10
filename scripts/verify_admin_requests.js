import dotenv from 'dotenv';
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';

dotenv.config();

const verifyAdminRequests = async () => {
    let connection;
    try {
        // 1. Setup DB Connection
        const sslConfig = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT) || 4000,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: process.env.DB_NAME,
            ssl: sslConfig
        });

        // 2. Insert Test Admin
        const testAdminId = 9999;
        const testEmail = 'verify_test@example.com';

        // Clean up first just in case
        await connection.query("DELETE FROM admins WHERE id = ?", [testAdminId]);

        await connection.query(
            "INSERT INTO admins (id, email, password) VALUES (?, ?, ?)",
            [testAdminId, testEmail, 'hashed_placeholder']
        );
        console.log("👤 Created Test Admin ID:", testAdminId);

        // 3. Generate Token
        const token = jwt.sign(
            {
                id: testAdminId,
                email: testEmail,
                role: 'admin'
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        // 4. Fetch Payment Requests
        const response = await fetch('http://localhost:5001/api/admin/payment-requests', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        console.log("📥 Response Status:", response.status);

        if (data.success) {
            console.log(`✅ Success! Found ${data.data.length} pending payment requests.`);
            if (data.data.length > 0) {
                console.log("📝 First Request:", data.data[0]);
                const req = data.data[0];
                if (req.amount && req.shopkeeper_name && req.transaction_id) {
                    console.log("✅ Data structure appears correct for Admin Frontend.");
                } else {
                    console.log("⚠️ Data structure might be missing keys expected by frontend!");
                }
            }
        } else {
            console.log("❌ Failed:", data.message);
            process.exit(1);
        }

    } catch (err) {
        console.error("❌ Verification error:", err);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.query("DELETE FROM admins WHERE id = 9999");
            await connection.end();
        }
        process.exit(0);
    }
};

verifyAdminRequests();
