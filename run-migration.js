import fs from "fs";
import path from "path";
import pool from "./config/db.js";

async function runMigration() {
  const migrationFile = path.resolve(
    process.cwd(),
    "schema/migrations/add_restock_columns.sql"
  );

  try {
    const sql = fs.readFileSync(migrationFile, "utf8");
    const connection = await pool.getConnection();

    console.log("🚀 Running migration: add_restock_columns.sql");
    console.log("-------------------------------------------");

    // Split by semicolon and execute each statement
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("--"));

    for (const statement of statements) {
      try {
        await connection.execute(statement);
        console.log("✅", statement.substring(0, 60) + "...");
      } catch (error) {
        console.error("❌ Error:", error.message);
        throw error;
      }
    }

    connection.release();
    console.log("-------------------------------------------");
    console.log("✅ Migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    process.exit(1);
  }
}

runMigration();
