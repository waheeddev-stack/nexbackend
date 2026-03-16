import db from "../config/db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setupServiceStatusTables() {
  try {
    console.log("🔧 Setting up service status tables...");

    // Read the migration SQL file
    const migrationPath = path.join(__dirname, "../migrations/001_create_service_status_tables.sql");
    const sql = fs.readFileSync(migrationPath, "utf8");

    // Split by semicolon and execute each statement
    const statements = sql
      .split(";")
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith("--"));

    for (const statement of statements) {
      try {
        await db.execute(statement);
        console.log("✅ Executed:", statement.substring(0, 50) + "...");
      } catch (error) {
        if (error.message.includes("already exists") || 
            error.message.includes("Duplicate")) {
          console.log("⚠️  Table already exists, skipping...");
        } else {
          throw error;
        }
      }
    }

    console.log("✅ Service status tables setup complete!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error setting up service status tables:", error);
    process.exit(1);
  }
}

setupServiceStatusTables();
