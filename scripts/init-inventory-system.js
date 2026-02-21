import db from '../config/db.js';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function initInventorySystem() {
  console.log('🔧 Initializing Inventory Management System...\n');
  
  try {
    // Read the schema file
    const schemaPath = join(__dirname, '..', 'schema', 'inventory_management.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Split into individual statements
    const statements = schema
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`📋 Found ${statements.length} SQL statements to execute\n`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      try {
        await db.query(statement);
        
        // Extract table/action name for logging
        const match = statement.match(/(?:CREATE TABLE|ALTER TABLE)\s+(?:IF NOT EXISTS\s+)?(\w+)/i);
        const tableName = match ? match[1] : `Statement ${i + 1}`;
        
        console.log(`✅ ${tableName}`);
        
      } catch (error) {
        // Ignore "already exists" errors
        if (error.message.includes('already exists') || 
            error.message.includes('Duplicate column') ||
            error.message.includes('Duplicate key name')) {
          const match = statement.match(/(?:CREATE TABLE|ALTER TABLE)\s+(?:IF NOT EXISTS\s+)?(\w+)/i);
          const tableName = match ? match[1] : `Statement ${i + 1}`;
          console.log(`⚠️  ${tableName} (already exists, skipping)`);
        } else {
          console.error(`❌ Error executing statement ${i + 1}:`, error.message);
          console.error('Statement:', statement.substring(0, 100) + '...');
        }
      }
    }
    
    console.log('\n✅ Inventory Management System initialized successfully!');
    console.log('\n📊 Summary:');
    console.log('  - Barcode columns added to products tables');
    console.log('  - inventory_logs table created');
    console.log('  - price_history table created');
    console.log('  - inventory_alerts table created');
    console.log('  - barcode_scans table created');
    
    // Verify tables
    console.log('\n🔍 Verifying tables...');
    const tables = ['inventory_logs', 'price_history', 'inventory_alerts', 'barcode_scans'];
    
    for (const table of tables) {
      try {
        const [rows] = await db.query(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`  ✅ ${table}: ${rows[0].count} records`);
      } catch (error) {
        console.log(`  ❌ ${table}: Error - ${error.message}`);
      }
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Failed to initialize inventory system:', error);
    process.exit(1);
  }
}

// Run the initialization
initInventorySystem();
