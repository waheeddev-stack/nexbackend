import pool from '../config/db.js';

(async () => {
    try {
        const [rows] = await pool.query("SHOW COLUMNS FROM shopkeepers");
        console.log("Columns in shopkeepers table:");
        rows.forEach(row => console.log(`- ${row.Field} (${row.Type})`));
        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
})();
