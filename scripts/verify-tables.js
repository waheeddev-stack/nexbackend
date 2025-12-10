import pool from "../config/db.js";

const verifyTables = async () => {
    try {
        const [tables] = await pool.query("SHOW TABLES LIKE 'billing_payments'");
        console.log("Table check result:", tables);
        if (tables.length > 0) {
            console.log("✅ billing_payments table exists!");
        } else {
            console.log("❌ billing_payments table MISSING!");
        }
    } catch (err) {
        console.error("Verification error:", err);
    } finally {
        process.exit(0);
    }
};

verifyTables();
