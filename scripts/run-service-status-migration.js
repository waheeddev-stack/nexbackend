import db from "../config/db.js";

async function runMigration() {
  try {
    console.log("🔧 Running service status migration...\n");

    // Create service_status table
    const createStatusTable = `
      CREATE TABLE IF NOT EXISTS service_status (
        id INT AUTO_INCREMENT PRIMARY KEY,
        status ENUM('online', 'offline') NOT NULL DEFAULT 'online',
        message VARCHAR(500),
        updated_by INT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_is_active (is_active),
        INDEX idx_updated_at (updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    console.log("Creating service_status table...");
    await db.execute(createStatusTable);
    console.log("✅ service_status table created\n");

    // Create service_status_history table
    const createHistoryTable = `
      CREATE TABLE IF NOT EXISTS service_status_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        previous_status ENUM('online', 'offline') NOT NULL,
        new_status ENUM('online', 'offline') NOT NULL,
        message VARCHAR(500),
        changed_by INT NOT NULL,
        changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45),
        user_agent VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_changed_at (changed_at),
        INDEX idx_changed_by (changed_by),
        INDEX idx_new_status (new_status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    console.log("Creating service_status_history table...");
    await db.execute(createHistoryTable);
    console.log("✅ service_status_history table created\n");

    // Insert default status
    console.log("Inserting default online status...");
    await db.execute(`
      INSERT IGNORE INTO service_status (status, message, is_active, created_at, updated_at)
      VALUES ('online', NULL, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    console.log("✅ Default status inserted\n");

    console.log("✅ Migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    console.error(error);
    process.exit(1);
  }
}

runMigration();
