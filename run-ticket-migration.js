import fs from "fs";
import path from "path";
import pool from "./config/db.js";

async function runMigration() {
  const migrationFile = path.resolve(
    process.cwd(),
    "migrations/005_create_support_tickets_table.sql"
  );

  try {
    const sql = fs.readFileSync(migrationFile, "utf8");
    const connection = await pool.getConnection();

    console.log("🚀 Running migration: 005_create_support_tickets_table.sql");
    console.log("-------------------------------------------");

    // Remove comment lines, then split by semicolons
    const noComments = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");

    const statements = noComments
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    console.log(`Found ${statements.length} SQL statement(s) to execute`);

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
    console.log("✅ Support tickets migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    process.exit(1);
  }
}

runMigration();
