import pool from '../config/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  let connection;
  
  try {
    console.log('🔄 Starting Google OAuth migration...\n');
    
    connection = await pool.getConnection();
    
    // Read the migration file
    const migrationPath = path.join(__dirname, '../schema/migrations/add_google_oauth.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Split by semicolons and filter out empty statements
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`📝 Found ${statements.length} SQL statements to execute\n`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Skip comments
      if (statement.startsWith('--') || statement.length === 0) {
        continue;
      }
      
      try {
        console.log(`⏳ Executing statement ${i + 1}/${statements.length}...`);
        await connection.query(statement);
        console.log(`✅ Statement ${i + 1} executed successfully\n`);
      } catch (error) {
        // Check if error is because column already exists
        if (error.code === 'ER_DUP_FIELDNAME') {
          console.log(`⚠️  Column already exists, skipping...\n`);
        } else if (error.code === 'ER_DUP_KEYNAME') {
          console.log(`⚠️  Index/Key already exists, skipping...\n`);
        } else {
          throw error;
        }
      }
    }
    
    console.log('✅ Google OAuth migration completed successfully!\n');
    console.log('📋 Changes made:');
    console.log('   - Added google_id column to users table');
    console.log('   - Added google_id column to shopkeepers table');
    console.log('   - Added unique constraints for google_id');
    console.log('   - Added indexes for faster lookups\n');
    
    // Verify the changes
    console.log('🔍 Verifying changes...\n');
    
    const [usersColumns] = await connection.query(
      "SHOW COLUMNS FROM users WHERE Field = 'google_id'"
    );
    
    const [shopkeepersColumns] = await connection.query(
      "SHOW COLUMNS FROM shopkeepers WHERE Field = 'google_id'"
    );
    
    if (usersColumns.length > 0) {
      console.log('✅ users.google_id column verified');
    } else {
      console.log('❌ users.google_id column not found');
    }
    
    if (shopkeepersColumns.length > 0) {
      console.log('✅ shopkeepers.google_id column verified');
    } else {
      console.log('❌ shopkeepers.google_id column not found');
    }
    
    console.log('\n🎉 Migration complete!');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    if (connection) {
      connection.release();
    }
    process.exit(0);
  }
}

runMigration();
