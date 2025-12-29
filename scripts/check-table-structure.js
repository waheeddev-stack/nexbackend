import 'dotenv/config';
import pool from '../config/db.js';

async function checkTableStructure() {
  try {
    console.log('🔍 Checking shopkeepers table structure...\n');
    
    const [columns] = await pool.query(`
      DESCRIBE shopkeepers
    `);
    
    console.log('📋 Shopkeepers table columns:');
    columns.forEach(col => {
      console.log(`  - ${col.Field} (${col.Type}) ${col.Null === 'YES' ? 'NULL' : 'NOT NULL'} ${col.Key ? `[${col.Key}]` : ''}`);
    });
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkTableStructure();
