import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function fixStatusEnum() {
  let connection;
  try {
    const sslConfig = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
    
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 4000,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      ssl: sslConfig
    });

    console.log('Connected to database');

    // Check current status enum
    const [columns] = await connection.query(`
      SELECT COLUMN_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'orders' 
      AND TABLE_SCHEMA = ?
      AND COLUMN_NAME = 'status'
    `, [process.env.DB_NAME]);

    console.log('Current status enum:', columns[0]?.COLUMN_TYPE);

    // Modify the status column to include 'Completed'
    console.log('\nUpdating status enum to include Completed...');
    
    try {
      await connection.query(`
        ALTER TABLE orders 
        MODIFY COLUMN status ENUM('Pending', 'Processing', 'Delivered', 'Completed', 'Cancelled') DEFAULT 'Pending'
      `);
      console.log('✅ Status enum updated successfully!');
    } catch (err) {
      if (err.message.includes('Duplicate')) {
        console.log('Status enum already includes Completed');
      } else {
        throw err;
      }
    }

    // Verify the change
    const [verifyColumns] = await connection.query(`
      SELECT COLUMN_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'orders' 
      AND TABLE_SCHEMA = ?
      AND COLUMN_NAME = 'status'
    `, [process.env.DB_NAME]);

    console.log('\nUpdated status enum:', verifyColumns[0]?.COLUMN_TYPE);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

fixStatusEnum();
