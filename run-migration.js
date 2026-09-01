import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const { Pool } = pg;

function normalizeConnectionString(cs) {
  try {
    const url = new URL(cs);
    const mode = url.searchParams.get("sslmode");
    if (mode === "require" || mode === "prefer" || mode === "verify-ca") {
      url.searchParams.set("sslmode", "verify-full");
      return url.toString();
    }
    return cs;
  } catch {
    return cs.replace(/sslmode=(require|prefer|verify-ca)/g, "sslmode=verify-full");
  }
}

function buildConnectionConfig() {
  const rawConnectionString =
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_URL ||
    process.env.POSTGRES_URL ||
    null;
  if (rawConnectionString) {
    const connectionString = normalizeConnectionString(rawConnectionString);
    return { connectionString, ssl: { rejectUnauthorized: false } };
  }
  const host = process.env.PGHOST || process.env.DB_HOST || "localhost";
  const port = parseInt(process.env.PGPORT || process.env.DB_PORT || "5432", 10);
  const user = process.env.PGUSER || process.env.DB_USER || "postgres";
  const password = process.env.PGPASSWORD || process.env.DB_PASS || "";
  const database = process.env.PGDATABASE || process.env.DB_NAME || "postgres";
  return { host, port, user, password, database, ssl: { rejectUnauthorized: false } };
}

function resolveMigrationFile(arg) {
  if (!arg) return null;
  const candidates = [
    path.resolve(process.cwd(), arg),
    path.resolve(process.cwd(), "schema", arg),
    path.resolve(process.cwd(), "schema/migrations", arg),
    path.resolve(__dirname, arg),
    path.resolve(__dirname, "schema", arg),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  // also try exact path
  if (fs.existsSync(arg)) return path.resolve(arg);
  return null;
}

// Split SQL respecting dollar-quoted blocks ($$ ... $$) and ignoring semicolons inside
function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let inDollar = false;
  let dollarTag = null;

  // Remove single-line -- comments but keep inside dollar blocks (simplified: strip comments outside)
  // We'll handle comments as part of parsing: skip -- until newline when not in dollar
  let i = 0;
  while (i < sql.length) {
    const remaining = sql.slice(i);

    // Detect start/end of dollar quoting
    if (!inDollar) {
      const m = remaining.match(/^\$([^$]*)\$/);
      if (m) {
        inDollar = true;
        dollarTag = m[0];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    } else {
      if (remaining.startsWith(dollarTag)) {
        current += dollarTag;
        i += dollarTag.length;
        inDollar = false;
        dollarTag = null;
        continue;
      }
    }

    if (!inDollar) {
      // Single line comment --
      if (sql[i] === "-" && sql[i + 1] === "-") {
        const nl = sql.indexOf("\n", i);
        if (nl === -1) break;
        current += sql.slice(i, nl + 1);
        i = nl + 1;
        continue;
      }
      // Block comment /* */
      if (sql[i] === "/" && sql[i + 1] === "*") {
        const end = sql.indexOf("*/", i + 2);
        if (end === -1) { current += sql.slice(i); break; }
        current += sql.slice(i, end + 2);
        i = end + 2;
        continue;
      }
      if (sql[i] === ";") {
        current += ";";
        const stmt = current.trim();
        // Strip comment lines and keep only real SQL
        const stripped = stmt.replace(/^--.*$/gm, "").trim();
        if (stripped && stripped !== ";" && stripped.length > 5) {
          statements.push(stripped);
        }
        current = "";
        i++;
        continue;
      }
    }

    current += sql[i];
    i++;
  }
  const tail = current.trim();
  if (tail) {
    const stripped = tail.replace(/^--.*$/gm, "").trim();
    if (stripped) statements.push(stripped);
  }
  return statements.filter((s) => s && s.replace(/--.*$/gm, "").trim().length > 5);
}

async function runMigration() {
  const argFile = process.argv[2];
  // Default to full postgres schema if no arg
  let migrationFile = null;
  let defaultUsed = false;

  if (argFile) {
    migrationFile = resolveMigrationFile(argFile);
    if (!migrationFile) {
      console.error(`❌ Migration file not found for arg: ${argFile}`);
      console.error("   Tried candidates:");
      console.error("   -", path.resolve(process.cwd(), argFile));
      console.error("   -", path.resolve(process.cwd(), "schema", argFile));
      console.error("   -", path.resolve(process.cwd(), "schema/migrations", argFile));
      process.exit(1);
    }
  } else {
    // Default: full schema
    const fullSchema = path.resolve(process.cwd(), "schema/nexkirana_postgres_schema.sql");
    const fallback = path.resolve(process.cwd(), "schema/migrations/004_ensure_savings_columns.sql");
    if (fs.existsSync(fullSchema)) {
      migrationFile = fullSchema;
      defaultUsed = true;
      console.log("ℹ️  No file arg given — defaulting to full schema: schema/nexkirana_postgres_schema.sql");
      console.log("   Hint: node run-migration.js <file>  e.g. node run-migration.js schema/nexkirana_postgres_schema.sql");
    } else if (fs.existsSync(fallback)) {
      migrationFile = fallback;
    } else {
      console.error("❌ No default migration file found");
      process.exit(1);
    }
  }

  const poolConfig = buildConnectionConfig();
  const pool = new Pool(poolConfig);

  try {
    const sqlRaw = fs.readFileSync(migrationFile, "utf8");
    console.log("🚀 Running migration:", path.basename(migrationFile));
    console.log("   File:", migrationFile);
    console.log("   Size:", (sqlRaw.length / 1024).toFixed(1), "KB");
    console.log("-------------------------------------------");

    const client = await pool.connect();
    try {
      // Quick connectivity test
      await client.query("SELECT 1");
      console.log("✅ DB connected");

      // Special handling for full schema: try single-shot execution first (pg supports multiple statements)
      const isFullSchema = path.basename(migrationFile) === "nexkirana_postgres_schema.sql" || defaultUsed;

      if (isFullSchema) {
        console.log("📦 Full schema detected — executing as transaction with statement splitting (dollar-aware)");
        const statements = splitSqlStatements(sqlRaw);
        console.log(`📋 Parsed ${statements.length} statement(s)`);

        let ok = 0, skipped = 0, failed = 0;
        await client.query("BEGIN");
        for (let idx = 0; idx < statements.length; idx++) {
          const stmt = statements[idx];
          const preview = stmt.replace(/\s+/g, " ").substring(0, 80);
          try {
            await client.query(stmt);
            ok++;
            if (stmt.toUpperCase().startsWith("CREATE TABLE") || stmt.toUpperCase().startsWith("CREATE INDEX") || stmt.toUpperCase().startsWith("ALTER SEQUENCE") || stmt.startsWith("DO $$")) {
              console.log(`✅ [${idx + 1}/${statements.length}] ${preview}...`);
            }
          } catch (err) {
            // idempotent: ignore "already exists" errors
            const msg = err.message || "";
            if (msg.includes("already exists") || msg.includes("duplicate key") || msg.includes("relation") && msg.includes("already exists")) {
              skipped++;
              console.log(`⏭️  [${idx + 1}/${statements.length}] skipped (already exists): ${preview}...`);
            } else {
              failed++;
              console.error(`❌ [${idx + 1}/${statements.length}] FAILED: ${preview}...`);
              console.error("   Error:", msg);
              console.error("   Full stmt:", stmt.slice(0, 500));
              await client.query("ROLLBACK");
              throw err;
            }
          }
        }
        await client.query("COMMIT");
        console.log("-------------------------------------------");
        console.log(`✅ Migration committed: ${ok} executed, ${skipped} skipped, ${failed} failed`);

        // Verify tables
        const { rows } = await client.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
        );
        console.log(`📋 Tables now in public schema (${rows.length}): ${rows.map(r => r.table_name).join(", ")}`);

        // Check shopkeepers specifically
        const shop = await client.query(
          "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='shopkeepers' ORDER BY ordinal_position"
        );
        if (shop.rows.length > 0) {
          console.log(`✅ shopkeepers columns (${shop.rows.length}): ${shop.rows.map(r => r.column_name).join(", ")}`);
        } else {
          console.warn("⚠️ shopkeepers table not found after migration!");
        }
      } else {
        // Single migration file: same split logic
        const statements = splitSqlStatements(sqlRaw);
        console.log(`📋 Parsed ${statements.length} statement(s)`);
        for (const stmt of statements) {
          try {
            await client.query(stmt);
            console.log("✅", stmt.replace(/\s+/g, " ").substring(0, 70) + "...");
          } catch (error) {
            console.error("❌ Error:", error.message);
            console.error("   Stmt:", stmt.slice(0, 300));
            throw error;
          }
        }
        console.log("-------------------------------------------");
        console.log("✅ Migration completed successfully!");
      }
    } finally {
      client.release();
    }
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    if (process.env.NODE_ENV !== "production") console.error(error);
    process.exit(1);
  }
}

runMigration();
