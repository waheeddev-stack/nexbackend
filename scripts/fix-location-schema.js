import pool from '../config/db.js';

(async () => {
    try {
        console.log("Starting location schema migration...");

        // 1. Fix longitude type in shopkeepers
        try {
            // Modify longitude to DOUBLE matching latitude
            await pool.query("ALTER TABLE shopkeepers MODIFY COLUMN longitude DOUBLE NULL");
            await pool.query("ALTER TABLE shopkeepers MODIFY COLUMN latitude DOUBLE NULL");
            console.log("✅ Updated shopkeepers location columns to DOUBLE");
        } catch (err) {
            console.error("⚠️ Error modifying shopkeepers columns:", err.message);
        }

        // 2. Create location_verifications table
        const createTableQuery = `
      CREATE TABLE IF NOT EXISTS location_verifications (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        shopkeeper_id BIGINT NOT NULL,
        latitude DOUBLE NOT NULL,
        longitude DOUBLE NOT NULL,
        distance INT,
        verified BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_shopkeeper (shopkeeper_id),
        FOREIGN KEY (shopkeeper_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;

        try {
            await pool.query(createTableQuery);
            console.log("✅ Created location_verifications table");
        } catch (err) {
            console.error("❌ Error creating location_verifications table:", err.message);
            throw err;
        }

        console.log("Migration completed.");
        process.exit(0);
    } catch (error) {
        console.error("Migration fatal error:", error);
        process.exit(1);
    }
})();
