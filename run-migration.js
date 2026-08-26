import fs from "fs";
import path from "path";
import pool from "./config/db.js";

async function runMigration() {
  // Allow a specific migration file to be passed as CLI arg, e.g.:
  //   node run-migration.js 004_ensure_savings_columns.sql
  // Defaults to the savings-columns migration (the one backing wallet savings).
  const argFile = process.argv[2];
  const migrationFile = path.resolve(
    process.cwd(),
    "schema/migrations",
    argFile || "004_ensure_savings_columns.sql"
  );

  try {
    if (!fs.existsSync(migrationFile)) {
      console.error("❌ Migration file not found:", migrationFile);
      process.exit(1);
    }

    const sql = fs.readFileSync(migrationFile, "utf8");
    const connection = await pool.getConnection();

    console.log("🚀 Running migration:", path.basename(migrationFile));
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
