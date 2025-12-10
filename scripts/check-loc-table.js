import pool from '../config/db.js';

(async () => {
    try {
        const [rows] = await pool.query("SHOW TABLES LIKE 'location_verifications'");
        console.log("Tables found:", rows.length);
        if (rows.length > 0) {
            console.log("location_verifications table exists.");
            const [cols] = await pool.query("DESCRIBE location_verifications");
            console.table(cols);
        } else {
            console.log("location_verifications table DOES NOT EXIST.");
        }
        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
})();
