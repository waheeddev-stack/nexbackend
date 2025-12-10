import pool from '../config/db.js';

(async () => {
    try {
        console.log("Starting simpler location schema migration...");

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
            // Try without FK if it fails
            if (err.message.includes("constraint")) {
                console.log("Retrying without FK...");
                const inputFK = `
             CREATE TABLE IF NOT EXISTS location_verifications (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                shopkeeper_id BIGINT NOT NULL,
                latitude DOUBLE NOT NULL,
                longitude DOUBLE NOT NULL,
                distance INT,
                verified BOOLEAN DEFAULT FALSE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_shopkeeper (shopkeeper_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
          `;
                await pool.query(inputFK);
                console.log("✅ Created location_verifications table (No FK)");
            } else {
                throw err;
            }
        }

        console.log("Migration completed.");
        process.exit(0);
    } catch (error) {
        console.error("Migration fatal error:", error);
        process.exit(1);
    }
})();
