import pg from "pg";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const { Pool } = pg;

// Normalize connection string to silence pg-connection-string SSL warning
// pg v8+ warns when sslmode=require/prefer/verify-ca are used as aliases for verify-full.
// We explicitly set verify-full to preserve current behavior (with rejectUnauthorized:false)
// or use uselibpqcompat=true if you want libpq compat. See https://www.postgresql.org/docs/current/libpq-ssl.html
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

// Resolve Neon / Postgres connection
function buildConnectionConfig() {
  // Prefer DATABASE_URL / NEON_DATABASE_URL / POSTGRES_URL
  const rawConnectionString =
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.NEON_POSTGRES_URL ||
    null;

  if (rawConnectionString) {
    const connectionString = normalizeConnectionString(rawConnectionString);
    return {
      connectionString,
      ssl: { rejectUnauthorized: false },
    };
  }

  // Fallback to individual PG vars or legacy DB_* vars
  const host =
    process.env.PGHOST || process.env.DB_HOST || "localhost";
  const port = parseInt(
    process.env.PGPORT || process.env.DB_PORT || "5432",
    10
  );
  const user =
    process.env.PGUSER || process.env.DB_USER || process.env.DB_USER || "postgres";
  const password =
    process.env.PGPASSWORD || process.env.DB_PASS || process.env.DB_PASSWORD || "";
  const database =
    process.env.PGDATABASE || process.env.DB_NAME || "postgres";

  const sslEnabled =
    process.env.PGSSLMODE === "require" ||
    process.env.DB_SSL === "true" ||
    host.includes("neon.tech") ||
    host.includes("pooler") ||
    process.env.NODE_ENV === "production";

  const config = {
    host,
    port,
    user,
    password,
    database,
  };
  if (sslEnabled) {
    config.ssl = { rejectUnauthorized: false };
  }
  return config;
}

const poolConfig = buildConnectionConfig();
poolConfig.max = parseInt(process.env.PG_POOL_MAX || "10", 10);
poolConfig.idleTimeoutMillis = 30000;
poolConfig.connectionTimeoutMillis = 10000;

if (process.env.NODE_ENV !== "production") {
  console.log("🔍 Database Configuration (Neon Postgres):");
  console.log("- host:", poolConfig.host || "(via connectionString)");
  console.log("- port:", poolConfig.port || "default");
  console.log("- user:", poolConfig.user ? "SET" : "NOT SET");
  console.log("- database:", poolConfig.database || "(via conn string)");
  console.log("- ssl:", !!poolConfig.ssl);
}

const pool = new Pool(poolConfig);

// Helpers: translate MySQL-specific SQL to Postgres
function translateMySQLSyntax(sql) {
  let s = sql;

  // Trim
  const trimmed = s.trim();

  // SHOW TABLES LIKE 'name'
  let m = trimmed.match(/^SHOW\s+TABLES\s+LIKE\s+['"]([^'"]+)['"]/i);
  if (m) {
    const table = m[1].replace(/%/g, "");
    return `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='${table}'`;
  }
  if (/^SHOW\s+TABLES/i.test(trimmed)) {
    return `SELECT table_name as Tables_in_db FROM information_schema.tables WHERE table_schema='public'`;
  }

  // SHOW COLUMNS FROM table LIKE 'col'
  m = trimmed.match(/^SHOW\s+COLUMNS\s+FROM\s+[`"]?(\w+)[`"]?\s+LIKE\s+['"]([^'"]+)['"]/i);
  if (m) {
    const table = m[1];
    const col = m[2].replace(/%/g, "");
    return `SELECT column_name as Field, data_type as Type FROM information_schema.columns WHERE table_name='${table}' AND column_name='${col}'`;
  }
  // SHOW COLUMNS FROM table (without LIKE)
  m = trimmed.match(/^SHOW\s+COLUMNS\s+FROM\s+[`"]?(\w+)[`"]?/i);
  if (m) {
    const table = m[1];
    return `SELECT column_name as Field, data_type as Type, is_nullable as Null FROM information_schema.columns WHERE table_name='${table}'`;
  }

  // DESCRIBE table
  m = trimmed.match(/^DESCRIBE\s+[`"]?(\w+)[`"]?/i);
  if (m) {
    const table = m[1];
    return `SELECT column_name as Field, data_type as Type, is_nullable as Null FROM information_schema.columns WHERE table_name='${table}'`;
  }

  // SHOW COLUMNS FROM users WHERE Field = 'google_id' (schema migration legacy)
  if (/SHOW\s+COLUMNS\s+FROM/i.test(trimmed) && /WHERE\s+Field/i.test(trimmed)) {
    const tableMatch = trimmed.match(/FROM\s+[`"]?(\w+)[`"]?/i);
    const fieldMatch = trimmed.match(/Field\s*=\s*['"]([^'"]+)['"]/i);
    if (tableMatch && fieldMatch) {
      return `SELECT column_name as Field FROM information_schema.columns WHERE table_name='${tableMatch[1]}' AND column_name='${fieldMatch[1]}'`;
    }
  }

  // Transaction keywords
  if (/^START\s+TRANSACTION/i.test(trimmed)) return "BEGIN";
  // DATE_SUB(NOW(), INTERVAL 15 DAY) -> NOW() - INTERVAL '15 days'
  s = s.replace(/DATE_SUB\s*\(\s*NOW\s*\(\s*\)\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/gi, "NOW() - INTERVAL '$1 days'");
  s = s.replace(/DATE_SUB\s*\(\s*CURDATE\s*\(\s*\)\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/gi, "CURRENT_DATE - INTERVAL '$1 days'");
  s = s.replace(/DATE_ADD\s*\(\s*DATE_FORMAT\s*\(\s*CURDATE\s*\(\s*\)\s*,\s*'[^']+'\s*\)\s*,\s*INTERVAL\s+1\s+MONTH\s*\)/gi, "(DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month')");
  s = s.replace(/DATE_FORMAT\s*\(\s*CURDATE\s*\(\s*\)\s*,\s*'%Y-%m-01'\s*\)/gi, "DATE_TRUNC('month', CURRENT_DATE)");
  s = s.replace(/CURDATE\s*\(\s*\)/gi, "CURRENT_DATE");
  s = s.replace(/WEEKDAY\s*\(\s*CURDATE\s*\(\s*\)\s*\)/gi, "EXTRACT(DOW FROM CURRENT_DATE)::int");
  // generic DATE_SUB with placeholder: DATE_SUB(NOW(), INTERVAL ? DAY) — keep for pg? not needed

  // Remove MySQL ENGINE / CHARSET / COLLATE tails in DDL
  s = s.replace(/ENGINE\s*=\s*InnoDB[^;]*?(\;|$)/gi, ";");
  s = s.replace(/DEFAULT\s+CHARSET\s*=\s*\w+/gi, "");
  s = s.replace(/COLLATE\s*=\s*\w+/gi, "");
  s = s.replace(/COLLATE\s+\w+/gi, "");
  s = s.replace(/CHARSET\s+utf8mb4/gi, "");

  // Replace backticks with double quotes (or remove)
  s = s.replace(/`([^`]+)`/g, '"$1"');

  // Replace INT(11) etc with INTEGER
  s = s.replace(/\bINT\s*\(\s*\d+\s*\)/gi, "INTEGER");
  s = s.replace(/\bTINYINT\s*\(\s*\d+\s*\)/gi, "SMALLINT");
  // AUTO_INCREMENT -> SERIAL handling: replace INTEGER AUTO_INCREMENT with SERIAL
  s = s.replace(/\bINTEGER\s+AUTO_INCREMENT\b/gi, "SERIAL");
  s = s.replace(/\bINT\s+AUTO_INCREMENT\b/gi, "SERIAL");
  s = s.replace(/\bAUTO_INCREMENT\b/gi, "");

  // MySQL -> PG compatibility: RAND() -> RANDOM()
  s = s.replace(/\bRAND\s*\(\s*\)/gi, "RANDOM()");

  // MySQL NOW() is same in PG, but pg uses NOW()
  // IF NOT EXISTS is supported

  return s;
}

// Convert MySQL ? placeholders to PG $1, $2 ...
function toPG(sql, params = []) {
  if (!params || params.length === 0) {
    // Still need to count ? to ensure no stray
    let idx = 0;
    const text = sql.replace(/\?/g, () => `$${++idx}`);
    return { text, values: [] };
  }

  // Handle case where single param is array for IN (?) — caller passed [idsArray] where idsArray length >1
  // mysql2 expands array; we need to expand placeholder
  const flatValues = [];
  let pgIndex = 0;
  let outSql = "";
  let paramIndex = 0;

  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "?" && paramIndex < params.length) {
      const val = params[paramIndex++];
      if (Array.isArray(val)) {
        if (val.length === 0) {
          // Empty array -> produce NULL list to avoid syntax error
          outSql += "(NULL)";
        } else {
          const placeholders = val.map(() => `$${++pgIndex}`).join(", ");
          outSql += `(${placeholders})`;
          // strip outer parens if original SQL already had IN (?) with parens? The caller often does IN (?) so we produce IN ((...)) double parens.
          // To avoid double parens, we inserted parentheses; if sql already has parens, it becomes IN ((1,2)). That's okay syntactically but ugly.
          // Instead, we will insert just list without outer parens and let caller's parens stay.
          // So revert: we added parens; if caller had IN (?), we should output placeholders without extra outer parens.
          // Quick fix: if outSql ends with "(...)", and sql segment before ? had "IN (" then we duplicate.
          // Simpler: generate without outer parens.
          // Let's correct: remove outer parens we just added and insert list directly if needed.
          // For now, handle by checking if we added double parens later.
          flatValues.push(...val);
        }
      } else {
        outSql += `$${++pgIndex}`;
        flatValues.push(val);
      }
    } else {
      outSql += sql[i];
    }
  }

  // Fix double parentheses for IN clause: "IN (( $1, $2 ))" -> "IN ( $1, $2 )"
  outSql = outSql.replace(/IN\s*\(\s*\(\s*/g, "IN (");
  outSql = outSql.replace(/\s*\)\s*\)/g, ")");

  // Edge: if we consumed fewer params than ? count due to array handling, adjust
  // Remaining params (if any) already handled.

  return { text: outSql, values: flatValues };
}

// Normalize DDL booleans: MySQL BOOLEAN default handling similar in PG

async function runQuery(sql, params = [], client = null) {
  const translated = translateMySQLSyntax(sql);
  const { text, values } = toPG(translated, params);

  // Append RETURNING id for INSERTs so we can emulate insertId
  let finalText = text;
  const isInsert = /^\s*INSERT\s+INTO/i.test(translated) && !/RETURNING/i.test(translated);
  if (isInsert) {
    // avoid double semicolon
    finalText = finalText.replace(/;\s*$/, "");
    finalText += " RETURNING id";
  }

  const executor = client || pool;
  // pg pool.query vs client.query both work
  const result = await executor.query(finalText, values);
  return result;
}

// Wrapper mimicking mysql2 pool interface
const db = {
  query: async (sql, params = []) => {
    const result = await runQuery(sql, params);
    // Emulate mysql2's [rows, fields] and result meta
    if (/^\s*SELECT/i.test(sql) || /information_schema/i.test(sql) || /^\s*SHOW/i.test(sql) || /^\s*DESCRIBE/i.test(sql) || /^\s*SELECT/i.test(translateMySQLSyntax(sql))) {
      return [result.rows, []];
    }
    if (/^\s*INSERT/i.test(sql)) {
      const rows = result.rows || [];
      const insertId = rows[0]?.id ?? result.rows?.[0]?.id ?? null;
      const ret = {
        insertId,
        affectedRows: result.rowCount,
        rowCount: result.rowCount,
        rows,
      };
      return [ret, []];
    }
    // UPDATE / DELETE
    const ret = {
      affectedRows: result.rowCount,
      rowCount: result.rowCount,
      changedRows: result.rowCount,
    };
    return [ret, []];
  },
  execute: async (sql, params = []) => {
    // In pg, query and execute are same (prepared)
    return db.query(sql, params);
  },
  getConnection: async () => {
    const client = await pool.connect();
    let inTransaction = false;
    return {
      query: async (sql, params = []) => {
        const trimmed = sql.trim().toUpperCase();
        if (trimmed === "BEGIN" || trimmed === "START TRANSACTION") {
          inTransaction = true;
          await client.query("BEGIN");
          return [{ affectedRows: 0 }, []];
        }
        if (trimmed === "COMMIT") {
          await client.query("COMMIT");
          inTransaction = false;
          return [{ affectedRows: 0 }, []];
        }
        if (trimmed === "ROLLBACK") {
          await client.query("ROLLBACK");
          inTransaction = false;
          return [{ affectedRows: 0 }, []];
        }
        const result = await runQuery(sql, params, client);
        if (/^\s*SELECT/i.test(sql) || /information_schema/i.test(sql)) {
          return [result.rows, []];
        }
        if (/^\s*INSERT/i.test(sql)) {
          const rows = result.rows || [];
          const insertId = rows[0]?.id ?? null;
          return [{ insertId, affectedRows: result.rowCount, rowCount: result.rowCount, rows }, []];
        }
        return [{ affectedRows: result.rowCount, rowCount: result.rowCount }, []];
      },
      execute: async function (sql, params) {
        return this.query(sql, params);
      },
      release: () => {
        client.release();
      },
      // expose underlying client for direct pg usage if needed
      _client: client,
    };
  },
  // expose raw pg pool for health checks
  pool,
  // helper for direct pg query without mysql emulation (for new code)
  pgQuery: (text, params) => pool.query(text, params),
  end: () => pool.end(),
};

 // Test connection on startup
(async () => {
  try {
    const client = await pool.connect();
    console.log("✅ Neon Postgres connected successfully!");
    const res = await client.query("SELECT 1 as test");
    console.log("🔍 Database test query successful:", res.rows);
    const tables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' LIMIT 5"
    );
    console.log(`📋 Sample tables: ${tables.rows.map((r) => r.table_name).join(", ") || "none yet"}`);
    client.release();
  } catch (err) {
    console.error("❌ Neon Postgres connection failed:", err.message);
    console.error("🔧 Check DATABASE_URL / PGHOST / DB_HOST etc.");
    if (process.env.NODE_ENV !== "production") {
      console.error(err);
    }
  }
})();

export default db;
export { pool };

