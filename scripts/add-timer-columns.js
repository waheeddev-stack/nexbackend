import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function addTimerColumns() {
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

    // Check if columns already exist
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'orders' 
      AND TABLE_SCHEMA = ?
      AND COLUMN_NAME IN ('has_timer', 'pickup_code', 'timer_started_at', 'timer_expires_at')
    `, [process.env.DB_NAME]);

    const existingColumns = columns.map(c => c.COLUMN_NAME);
    console.log('Existing timer columns:', existingColumns);

    // Add missing columns
    const columnsToAdd = [
      { name: 'has_timer', sql: 'ADD COLUMN has_timer TINYINT(1) DEFAULT 0' },
      { name: 'pickup_code', sql: 'ADD COLUMN pickup_code VARCHAR(10) DEFAULT NULL' },
      { name: 'timer_started_at', sql: 'ADD COLUMN timer_started_at DATETIME DEFAULT NULL' },
      { name: 'timer_expires_at', sql: 'ADD COLUMN timer_expires_at DATETIME DEFAULT NULL' }
    ];

    for (const col of columnsToAdd) {
      if (!existingColumns.includes(col.name)) {
        console.log(`Adding column: ${col.name}`);
        try {
          await connection.query(`ALTER TABLE orders ${col.sql}`);
          console.log(`✅ Added ${col.name}`);
        } catch (err) {
          if (err.code === 'ER_DUP_FIELDNAME') {
            console.log(`Column ${col.name} already exists`);
          } else {
            throw err;
          }
        }
      } else {
        console.log(`Column ${col.name} already exists`);
      }
    }

    // Verify columns
    const [verifyColumns] = await connection.query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'orders' 
      AND TABLE_SCHEMA = ?
      AND COLUMN_NAME IN ('has_timer', 'pickup_code', 'timer_started_at', 'timer_expires_at')
    `, [process.env.DB_NAME]);

    console.log('\n✅ Timer columns in orders table:');
    verifyColumns.forEach(col => {
      console.log(`  - ${col.COLUMN_NAME}: ${col.DATA_TYPE} (nullable: ${col.IS_NULLABLE}, default: ${col.COLUMN_DEFAULT})`);
    });

    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

addTimerColumns();
