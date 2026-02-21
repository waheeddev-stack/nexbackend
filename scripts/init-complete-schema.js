import db from '../config/db.js';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function initCompleteSchema() {
  console.log('🔧 Initializing Complete NexKirana Database Schema...\n');
  
  try {
    // Read the consolidated schema file
    const schemaPath = join(__dirname, '..', 'schema', 'nexkirana_complete_schema.sql');
    
    if (!fs.existsSync(schemaPath)) {
      throw new Error('Schema file not found: ' + schemaPath);
    }
    
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Split into individual statements
    const statements = schema
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => {
        // Filter out comments and empty statements
        return stmt.length > 0 && 
               !stmt.startsWith('--') && 
               !stmt.startsWith('/*') &&
               !stmt.startsWith('SET') &&
               !stmt.match(/^\/\*/);
      });
    
    console.log(`📋 Found ${statements.length} SQL statements to execute\n`);
    console.log('⏳ Creating tables...\n');
    
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      try {
        await db.query(statement);
        
        // Extract table name for logging
        const match = statement.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?(\w+)`?/i);
        const tableName = match ? match[1] : `Statement ${i + 1}`;
        
        console.log(`✅ ${tableName}`);
        successCount++;
        
      } catch (error) {
        // Check if it's a "table already exists" error
        if (error.message.includes('already exists') || 
            error.message.includes('Duplicate column') ||
            error.message.includes('Duplicate key name')) {
          const match = statement.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?(\w+)`?/i);
          const tableName = match ? match[1] : `Statement ${i + 1}`;
          console.log(`⚠️  ${tableName} (already exists, skipping)`);
          skipCount++;
        } else {
          console.error(`❌ Error executing statement ${i + 1}:`, error.message);
          console.error('Statement:', statement.substring(0, 100) + '...');
          errorCount++;
        }
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 Schema Initialization Summary');
    console.log('='.repeat(60));
    console.log(`✅ Successfully created: ${successCount} tables`);
    console.log(`⚠️  Already existed: ${skipCount} tables`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log('='.repeat(60) + '\n');
    
    // Verify tables
    console.log('🔍 Verifying database tables...\n');
    
    const expectedTables = [
      'admins',
      'users', 
      'shopkeepers',
      'global_products',
      'products',
      'orders',
      'order_items',
      'order_timers',
      'inventory_logs',
      'price_history',
      'inventory_alerts',
      'barcode_scans',
      'stock_restoration_log',
      'billing_payments',
      'payment_info'
    ];
    
    let verifiedCount = 0;
    let missingCount = 0;
    
    for (const table of expectedTables) {
      try {
        const [rows] = await db.query(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`  ✅ ${table.padEnd(25)} - ${rows[0].count} records`);
        verifiedCount++;
      } catch (error) {
        console.log(`  ❌ ${table.padEnd(25)} - NOT FOUND`);
        missingCount++;
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📈 Verification Results');
    console.log('='.repeat(60));
    console.log(`✅ Verified: ${verifiedCount}/${expectedTables.length} tables`);
    console.log(`❌ Missing: ${missingCount} tables`);
    console.log('='.repeat(60) + '\n');
    
    if (missingCount === 0) {
      console.log('🎉 SUCCESS! All tables created and verified!\n');
      console.log('📚 Database Schema Summary:');
      console.log('   - Core Tables: 3 (admins, users, shopkeepers)');
      console.log('   - Product Tables: 2 (global_products, products)');
      console.log('   - Order Tables: 3 (orders, order_items, order_timers)');
      console.log('   - Inventory Tables: 4 (inventory_logs, price_history, inventory_alerts, barcode_scans)');
      console.log('   - Billing Tables: 2 (billing_payments, payment_info)');
      console.log('   - Utility Tables: 1 (stock_restoration_log)');
      console.log('   - Total: 15 tables\n');
      
      console.log('✨ Your database is ready to use!');
      console.log('   Run: npm run dev (to start the server)\n');
    } else {
      console.log('⚠️  WARNING: Some tables are missing!');
      console.log('   Please check the error messages above.\n');
    }
    
    process.exit(missingCount === 0 ? 0 : 1);
    
  } catch (error) {
    console.error('\n❌ Failed to initialize schema:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  }
}

// Run the initialization
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║     NexKirana Complete Database Schema Initialization     ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

initCompleteSchema();
