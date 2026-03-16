import db from "../config/db.js";

async function checkAdminsTable() {
  try {
    console.log("🔍 Checking admins table structure\n");

    // Get table structure
    const [columns] = await db.execute(`
      SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'nexkiranadb' AND TABLE_NAME = 'admins'
    `);

    console.log("Admins table columns:");
    columns.forEach(col => {
      console.log(`  - ${col.COLUMN_NAME}: ${col.COLUMN_TYPE} (nullable: ${col.IS_NULLABLE})`);
    });

    console.log("\n---\n");

    // Get sample admin data
    const [admins] = await db.execute(`
      SELECT * FROM admins LIMIT 1
    `);

    console.log("Sample admin record:");
    console.log(JSON.stringify(admins[0], null, 2));

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

checkAdminsTable();
