import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const verifyAdmin = async () => {
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

        console.log("🔍 Checking billing_payments table for recent payments...");
        const [payments] = await connection.query("SELECT * FROM billing_payments ORDER BY id DESC LIMIT 1");

        if (payments.length > 0) {
            console.log("✅ Admin View Verification: Found payment request:", payments[0]);
        } else {
            console.log("❌ No payments found in table!");
        }

    } catch (err) {
        console.error("❌ Verification error:", err);
    } finally {
        if (connection) await connection.end();
        process.exit(0);
    }
};

verifyAdmin();
