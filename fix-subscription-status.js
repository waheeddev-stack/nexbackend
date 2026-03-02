import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from nexbackend directory
dotenv.config({ path: path.resolve(__dirname, '.env') });

async function fixSubscriptionStatus() {
  let pool;
  
  try {
    console.log('🔍 Database Configuration:');
    console.log('- DB_HOST:', process.env.DB_HOST);
    console.log('- DB_USER:', process.env.DB_USER);
    console.log('- DB_NAME:', process.env.DB_NAME);
    console.log('- DB_PORT:', process.env.DB_PORT);
    console.log('- DB_SSL:', process.env.DB_SSL);
    console.log('');

    // Create database connection
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER,
      password: process.env.DB_PASS || process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      waitForConnections: true,
      connectionLimit: 10
    });

    console.log('✅ Connected to database...\n');

    // STEP 1: Check current state
    console.log('=== STEP 1: Check current state ===');
    
    const [current] = await pool.query(
      'SELECT subscription_status, COUNT(*) as count FROM shopkeepers GROUP BY subscription_status'
    );
    console.log('Current status distribution:');
    console.table(current);

    const [columns] = await pool.query(
      'SHOW COLUMNS FROM shopkeepers LIKE "subscription_status"'
    );
    console.log('\nCurrent column definition:');
    console.table(columns);

    // STEP 2: Migrate data FIRST (before altering column)
    console.log('\n=== STEP 2: Migrate data ===');
    
    // Convert 'trial' to 'active'
    const [result1] = await pool.query(
      'UPDATE shopkeepers SET subscription_status = "active" WHERE subscription_status = "trial"'
    );
    console.log(`✅ Converted ${result1.affectedRows} trial records to active`);

    // Convert 'free' to 'active'
    const [result2] = await pool.query(
      'UPDATE shopkeepers SET subscription_status = "active" WHERE subscription_status = "free"'
    );
    console.log(`✅ Converted ${result2.affectedRows} free records to active`);

    // Fix NULL values
    const [result3] = await pool.query(
      'UPDATE shopkeepers SET subscription_status = "active" WHERE subscription_status IS NULL OR subscription_status = ""'
    );
    console.log(`✅ Fixed ${result3.affectedRows} NULL/empty records`);

    // STEP 3: Alter column to ENUM
    console.log('\n=== STEP 3: Alter column to ENUM ===');
    
    await pool.query(
      'ALTER TABLE shopkeepers MODIFY COLUMN subscription_status ENUM("active", "overdue", "grace_period", "suspended") DEFAULT "active"'
    );
    console.log('✅ Column altered to ENUM successfully');

    // STEP 4: Verify fix
    console.log('\n=== STEP 4: Verify fix ===');
    
    const [updated] = await pool.query(
      'SELECT subscription_status, COUNT(*) as count FROM shopkeepers GROUP BY subscription_status'
    );
    console.log('Updated status distribution:');
    console.table(updated);

    const [newColumns] = await pool.query(
      'SHOW COLUMNS FROM shopkeepers LIKE "subscription_status"'
    );
    console.log('\nNew column definition:');
    console.table(newColumns);

    // Show sample shopkeepers
    const [shopkeepers] = await pool.query(
      'SELECT id, name, email, subscription_status, is_verified FROM shopkeepers LIMIT 5'
    );
    console.log('\nSample shopkeepers:');
    console.table(shopkeepers);

    console.log('\n✅ Database fix completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Test suspend/unsuspend in admin panel');
    console.log('2. Test shopkeeper login with suspended account');
    console.log('3. Verify badge colors in admin panel');

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error('Stack:', err.stack);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
      console.log('\n✅ Database connection closed');
    }
  }
}

// Run the fix
fixSubscriptionStatus();
