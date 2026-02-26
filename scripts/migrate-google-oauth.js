import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  console.log('🔄 Running Google OAuth migration...');
  
  try {
    // Read migration file
    const migrationPath = path.join(__dirname, '../schema/migrations/add_google_oauth.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Split by semicolon and filter out comments and empty statements
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    // Execute each statement
    for (const statement of statements) {
      try {
        await db.query(statement);
        console.log('✅ Executed:', statement.substring(0, 50) + '...');
      } catch (error) {
        // Ignore errors for duplicate columns/indexes
        if (error.message.includes('Duplicate column') || 
            error.message.includes('Duplicate key name') ||
            error.message.includes('already exists')) {
          console.log('⚠️  Already exists, skipping:', statement.substring(0, 50) + '...');
        } else {
          throw error;
        }
      }
    }
    
    console.log('✅ Google OAuth migration completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Add your Google OAuth credentials to .env file:');
    console.log('   - GOOGLE_CLIENT_ID');
    console.log('   - GOOGLE_CLIENT_SECRET');
    console.log('   - GOOGLE_CALLBACK_URL');
    console.log('2. Run: npm install');
    console.log('3. Restart the server');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
