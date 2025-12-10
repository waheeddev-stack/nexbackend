import pool from "../config/db.js";

const createTable = async () => {
    try {
        console.log("📋 Creating billing_payments table...");
        await pool.query(`
      CREATE TABLE IF NOT EXISTS billing_payments (
        id BIGINT(20) NOT NULL PRIMARY KEY,
        shopkeeper_id BIGINT(20) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        payment_method VARCHAR(50),
        transaction_id VARCHAR(255),
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        approved_by BIGINT(20) DEFAULT NULL,
        approved_at DATETIME DEFAULT NULL,
        notes TEXT
      )
    `);
        console.log("✅ billing_payments table created successfully!");
    } catch (err) {
        console.error("❌ Error creating table:", err);
    } finally {
        process.exit(0);
    }
};

createTable();
