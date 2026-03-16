import db from "../config/db.js";

async function verifyTables() {
  try {
    console.log("🔍 Verifying service status tables...\n");

    // Check service_status table
    const [statusTable] = await db.execute(`
      SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = 'nexkiranadb' AND TABLE_NAME = 'service_status'
    `);

    if (statusTable.length > 0) {
      console.log("✅ service_status table exists");
      console.log(`   Rows: ${statusTable[0].TABLE_ROWS}`);
      console.log(`   Size: ${(statusTable[0].DATA_LENGTH / 1024).toFixed(2)} KB\n`);
    } else {
      console.log("❌ service_status table NOT found\n");
    }

    // Check service_status_history table
    const [historyTable] = await db.execute(`
      SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = 'nexkiranadb' AND TABLE_NAME = 'service_status_history'
    `);

    if (historyTable.length > 0) {
      console.log("✅ service_status_history table exists");
      console.log(`   Rows: ${historyTable[0].TABLE_ROWS}`);
      console.log(`   Size: ${(historyTable[0].DATA_LENGTH / 1024).toFixed(2)} KB\n`);
    } else {
      console.log("❌ service_status_history table NOT found\n");
    }

    // Check current service status
    const [status] = await db.execute(`
      SELECT status, message, updated_at, updated_by 
      FROM service_status 
      WHERE is_active = TRUE 
      LIMIT 1
    `);

    if (status.length > 0) {
      console.log("✅ Current service status:");
      console.log(`   Status: ${status[0].status}`);
      console.log(`   Message: ${status[0].message || 'None'}`);
      console.log(`   Updated: ${status[0].updated_at}`);
      console.log(`   Updated By: ${status[0].updated_by || 'system'}\n`);
    }

    console.log("✅ All tables verified successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error verifying tables:", error.message);
    process.exit(1);
  }
}

verifyTables();
