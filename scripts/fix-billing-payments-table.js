import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function fixBillingPaymentsTable() {
  let connection;
  
  try {
    // SSL configuration for TiDB Cloud
    const dbSsl = process.env.DB_SSL && process.env.DB_SSL.trim().toLowerCase() === "true";
    let sslConfig = undefined;
    
    if (dbSsl) {
      sslConfig = {
        rejectUnauthorized: false
      };
      console.log("Using SSL for TiDB Cloud connection");
    }

    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 4000,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      ssl: sslConfig
    });

    console.log('Connected to database\n');

    // Check current structure
    const [columns] = await connection.query("DESCRIBE billing_payments");
    
    console.log('Current table structure:');
    const existingColumns = columns.map(col => col.Field);
    existingColumns.forEach(col => console.log(`  - ${col}`));
    console.log('');

    // Add missing columns
    const columnsToAdd = [
      {
        name: 'created_at',
        sql: 'ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP'
      },
      {
        name: 'updated_at',
        sql: 'ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
      }
    ];

    for (const column of columnsToAdd) {
      if (!existingColumns.includes(column.name)) {
        console.log(`Adding column: ${column.name}...`);
        await connection.query(`ALTER TABLE billing_payments ${column.sql}`);
        console.log(`✅ Added ${column.name}`);
      } else {
        console.log(`✓ Column ${column.name} already exists`);
      }
    }

    console.log('\n✅ Table structure updated successfully!');

    // Show final structure
    const [finalColumns] = await connection.query("DESCRIBE billing_payments");
    console.log('\nFinal table structure:');
    finalColumns.forEach(col => {
      console.log(`  - ${col.Field}: ${col.Type} ${col.Null === 'NO' ? 'NOT NULL' : 'NULL'} ${col.Default ? `DEFAULT ${col.Default}` : ''}`);
    });

    // Show existing records
    const [count] = await connection.query("SELECT COUNT(*) as total FROM billing_payments");
    console.log(`\nTotal records: ${count[0].total}`);

    if (count[0].total > 0) {
      const [records] = await connection.query(
        "SELECT id, shopkeeper_id, amount, payment_method, status, payment_date FROM billing_payments ORDER BY payment_date DESC LIMIT 5"
      );
      console.log('\nRecent payments:');
      records.forEach(payment => {
        console.log(`  - ID: ${payment.id}, Shopkeeper: ${payment.shopkeeper_id}, Amount: ${payment.amount}, Status: ${payment.status}`);
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
    console.error('Full error:', error);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\nDatabase connection closed');
    }
  }
}

fixBillingPaymentsTable();
