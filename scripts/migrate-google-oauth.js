import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkColumnExists(tableName, columnName) {
  try {
    const [rows] = await db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = ? 
      AND COLUMN_NAME = ?
    `, [tableName, columnName]);
    return rows.length > 0;
  } catch (error) {
    console.error(`Error checking column ${tableName}.${columnName}:`, error);
    return false;
  }
}

async function runMigration() {
  console.log('🔄 Running Google OAuth migration...');
  
  try {
    // Check if columns already exist
    const usersGoogleIdExists = await checkColumnExists('users', 'google_id');
    const shopkeepersGoogleIdExists = await checkColumnExists('shopkeepers', 'google_id');
    
    console.log(`📋 Column status:`);
    console.log(`   users.google_id: ${usersGoogleIdExists ? '✅ exists' : '❌ missing'}`);
    console.log(`   shopkeepers.google_id: ${shopkeepersGoogleIdExists ? '✅ exists' : '❌ missing'}`);
    
    // Add columns if they don't exist
    if (!usersGoogleIdExists) {
      console.log('🔧 Adding google_id column to users table...');
      await db.query(`
        ALTER TABLE \`users\` 
        ADD COLUMN \`google_id\` VARCHAR(255) DEFAULT NULL AFTER \`email\`
      `);
      console.log('✅ Added google_id column to users table');
    }
    
    if (!shopkeepersGoogleIdExists) {
      console.log('🔧 Adding google_id column to shopkeepers table...');
      await db.query(`
        ALTER TABLE \`shopkeepers\` 
        ADD COLUMN \`google_id\` VARCHAR(255) DEFAULT NULL AFTER \`email\`
      `);
      console.log('✅ Added google_id column to shopkeepers table');
    }
    
    // Add unique constraints (with error handling)
    try {
      await db.query(`ALTER TABLE \`users\` ADD UNIQUE KEY \`unique_google_id_users\` (\`google_id\`)`);
      console.log('✅ Added unique constraint to users.google_id');
    } catch (error) {
      if (error.message.includes('Duplicate key name')) {
        console.log('⚠️  Unique constraint already exists on users.google_id');
      } else {
        throw error;
      }
    }
    
    try {
      await db.query(`ALTER TABLE \`shopkeepers\` ADD UNIQUE KEY \`unique_google_id_shopkeepers\` (\`google_id\`)`);
      console.log('✅ Added unique constraint to shopkeepers.google_id');
    } catch (error) {
      if (error.message.includes('Duplicate key name')) {
        console.log('⚠️  Unique constraint already exists on shopkeepers.google_id');
      } else {
        throw error;
      }
    }
    
    // Add indexes (with error handling)
    try {
      await db.query(`CREATE INDEX \`idx_users_google_id\` ON \`users\`(\`google_id\`)`);
      console.log('✅ Added index to users.google_id');
    } catch (error) {
      if (error.message.includes('Duplicate key name')) {
        console.log('⚠️  Index already exists on users.google_id');
      } else {
        throw error;
      }
    }
    
    try {
      await db.query(`CREATE INDEX \`idx_shopkeepers_google_id\` ON \`shopkeepers\`(\`google_id\`)`);
      console.log('✅ Added index to shopkeepers.google_id');
    } catch (error) {
      if (error.message.includes('Duplicate key name')) {
        console.log('⚠️  Index already exists on shopkeepers.google_id');
      } else {
        throw error;
      }
    }
    
    console.log('✅ Google OAuth migration completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. ✅ Google OAuth credentials are already configured in .env');
    console.log('2. ✅ Dependencies are installed');
    console.log('3. Restart the server to apply changes');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
