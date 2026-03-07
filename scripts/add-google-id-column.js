import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function addGoogleIdColumn() {
  let connection;
  
  try {
    console.log('🔌 Connecting to database...');
    
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,  // Changed from DB_PASSWORD to DB_PASS
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
      ssl: process.env.DB_SSL === 'true' ? {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2'
      } : false,
    });

    console.log('✅ Connected to database');

    // Check if google_id column already exists
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'users' 
        AND COLUMN_NAME = 'google_id'
    `, [process.env.DB_NAME]);

    if (columns.length > 0) {
      console.log('ℹ️  google_id column already exists');
      return;
    }

    console.log('📝 Adding google_id column to users table...');

    // Add google_id column
    await connection.query(`
      ALTER TABLE users 
      ADD COLUMN google_id VARCHAR(255) UNIQUE NULL 
      AFTER email
    `);

    console.log('✅ google_id column added successfully');

    // Add index for faster lookups
    console.log('📝 Adding index on google_id...');
    
    await connection.query(`
      CREATE INDEX idx_google_id ON users(google_id)
    `);

    console.log('✅ Index added successfully');

    // Check if email_verified column exists, if not add it
    const [emailVerifiedColumns] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'users' 
        AND COLUMN_NAME = 'email_verified'
    `, [process.env.DB_NAME]);

    if (emailVerifiedColumns.length === 0) {
      console.log('📝 Adding email_verified column...');
      
      await connection.query(`
        ALTER TABLE users 
        ADD COLUMN email_verified TINYINT(1) DEFAULT 0 
        AFTER email
      `);

      console.log('✅ email_verified column added successfully');
    } else {
      console.log('ℹ️  email_verified column already exists');
    }

    console.log('\n✅ Database migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Add GOOGLE_CLIENT_ID to nexbackend/.env');
    console.log('2. Install google-auth-library: npm install google-auth-library');
    console.log('3. Add Google auth route to your Express app');
    console.log('4. Configure Firebase Console with SHA-1 certificates');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Database connection closed');
    }
  }
}

// Run migration
addGoogleIdColumn();
