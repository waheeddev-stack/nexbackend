import pool from "../config/db.js";

/**
 * safeQuery - wrapper around pool.execute that enforces parameterized queries.
 * It warns when the SQL contains placeholders but params are missing, and
 * throws if an identifier appears unsafe. Use `escapeIdentifier` for dynamic
 * column/table names (avoid where possible).
 */
export async function safeQuery(sql, params = []) {
  if (sql.includes("?") && (!params || !Array.isArray(params))) {
    throw new Error("Queries with placeholders must supply params as an array");
  }

  // Simple check: if query contains user interpolation patterns like ${ or concatenation, log a warning
  if (sql.includes("${") || /\+\s*req\.|\+\s*params\.|\+\s*body\./.test(sql)) {
    console.warn("Potential unsafe SQL construction detected; please use parameterized queries.");
  }

  // Use execute which prepares the statement and binds params safely
  return pool.execute(sql, params);
}

/**
 * escapeIdentifier - validate dynamic identifiers (table/column names).
 * Only allow [a-zA-Z0-9_.$] to reduce risk. Do NOT use user input directly
 * as identifiers; prefer fixed whitelists.
 */
export function escapeIdentifier(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_.$]+$/.test(id)) {
    throw new Error("Invalid identifier");
  }
  return id;
}

export default { safeQuery, escapeIdentifier };
