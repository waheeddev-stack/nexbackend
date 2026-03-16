import db from "../config/db.js";

async function checkStatus() {
  try {
    console.log("🔍 Checking service status in database...\n");

    const [rows] = await db.execute(`
      SELECT 
        id,
        status,
        message,
        updated_at,
        updated_by,
        is_active,
        created_at
      FROM service_status
      ORDER BY created_at DESC
      LIMIT 5
    `);

    console.log("All service status records:");
    rows.forEach((row, index) => {
      console.log(`\n${index + 1}. ID: ${row.id}`);
      console.log(`   Status: ${row.status}`);
      console.log(`   Message: ${row.message || 'None'}`);
      console.log(`   Active: ${row.is_active}`);
      console.log(`   Updated: ${row.updated_at}`);
      console.log(`   Created: ${row.created_at}`);
    });

    console.log("\n---\n");

    const [activeStatus] = await db.execute(`
      SELECT status, message, updated_at, updated_by, is_active
      FROM service_status
      WHERE is_active = TRUE
      LIMIT 1
    `);

    if (activeStatus.length > 0) {
      console.log("✅ Active status record:");
      console.log(`   Status: ${activeStatus[0].status}`);
      console.log(`   Message: ${activeStatus[0].message || 'None'}`);
      console.log(`   Updated: ${activeStatus[0].updated_at}`);
    } else {
      console.log("❌ No active status record found!");
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

checkStatus();
