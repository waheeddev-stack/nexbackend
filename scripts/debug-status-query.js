import db from "../config/db.js";

async function debugQuery() {
  try {
    console.log("🔍 Debugging service status query\n");

    // Test 1: Check raw data
    console.log("1️⃣  Raw service_status table data:");
    const [allRows] = await db.execute(`
      SELECT id, status, is_active, updated_at FROM service_status
    `);
    console.log(JSON.stringify(allRows, null, 2));

    console.log("\n---\n");

    // Test 2: Check WHERE clause with is_active = TRUE
    console.log("2️⃣  Query with WHERE is_active = TRUE:");
    const [trueRows] = await db.execute(`
      SELECT id, status, is_active FROM service_status WHERE is_active = TRUE
    `);
    console.log(`Found ${trueRows.length} rows`);
    console.log(JSON.stringify(trueRows, null, 2));

    console.log("\n---\n");

    // Test 3: Check WHERE clause with is_active = 1
    console.log("3️⃣  Query with WHERE is_active = 1:");
    const [oneRows] = await db.execute(`
      SELECT id, status, is_active FROM service_status WHERE is_active = 1
    `);
    console.log(`Found ${oneRows.length} rows`);
    console.log(JSON.stringify(oneRows, null, 2));

    console.log("\n---\n");

    // Test 4: Full query with JOIN
    console.log("4️⃣  Full query with JOIN:");
    const [joinRows] = await db.execute(`
      SELECT 
        ss.id,
        ss.status,
        ss.message,
        ss.updated_at as lastUpdated,
        ss.is_active,
        a.username as updatedBy
      FROM service_status ss
      LEFT JOIN admins a ON ss.updated_by = a.id
      WHERE ss.is_active = TRUE
      LIMIT 1
    `);
    console.log(`Found ${joinRows.length} rows`);
    console.log(JSON.stringify(joinRows, null, 2));

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error);
    process.exit(1);
  }
}

debugQuery();
