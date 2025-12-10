import pool from '../config/db.js';

(async () => {
    try {
        const [rows] = await pool.query("DESCRIBE shopkeepers");
        console.log("Shopkeepers Table Schema:");
        console.table(rows);
        process.exit(0);
    } catch (error) {
        console.error("Error describing table:", error);
        process.exit(1);
    }
})();
