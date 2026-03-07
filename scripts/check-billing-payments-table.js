import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function checkBillingPaymentsTable() {
  let connection;
  
  try {
    // SSL configuration for TiDB Cloud
    const dbSsl = process.env.DB_SSL && process.env.DB_SSL.trim().toLowerCase() === "true";
    let sslConfig = undefined;
    
    if (dbSsl) {
      sslConfig = {
        rejectUnauthorized: false // For TiDB Cloud compatibility
      };
      console.log("Using SSL for TiDB Cloud connection");
    }

    // Create connection
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 4000,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      ssl: sslConfig
    });

    console.log('Connected to database');

    // Check if table exists
    const [tables] = await connection.query(
      "SHOW TABLES LIKE 'billing_payments'"
    );

    if (tables.length === 0) {
      console.log('❌ billing_payments table does NOT exist');
      console.log('Creating billing_payments table...');

      // Create the table
      await connection.query(`
        CREATE TABLE IF NOT EXISTS billing_payments (
          id INT AUTO_INCREMENT PRIMARY KEY,
          shopkeeper_id INT NOT NULL,
          amount DECIMAL(10, 2) NOT NULL,
          payment_method VARCHAR(50) DEFAULT 'upi',
          transaction_id VARCHAR(100),
          payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
          status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
          notes TEXT,
          approved_by INT,
          approved_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (shopkeeper_id) REFERENCES shopkeepers(id) ON DELETE CASCADE,
          FOREIGN KEY (approved_by) REFERENCES admins(id) ON DELETE SET NULL,
          INDEX idx_shopkeeper_id (shopkeeper_id),
          INDEX idx_status (status),
          INDEX idx_payment_date (payment_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      console.log('✅ billing_payments table created successfully');
    } else {
      console.log('✅ billing_payments table exists');

      // Check table structure
      const [columns] = await connection.query(
        "DESCRIBE billing_payments"
      );

      console.log('\nTable structure:');
      columns.forEach(col => {
        console.log(`  - ${col.Field}: ${col.Type} ${col.Null === 'NO' ? 'NOT NULL' : 'NULL'} ${col.Key ? `(${col.Key})` : ''}`);
      });

      // Check for any existing records
      const [count] = await connection.query(
        "SELECT COUNT(*) as total FROM billing_payments"
      );

      console.log(`\nTotal records: ${count[0].total}`);

      // Show recent records if any
      if (count[0].total > 0) {
        const [recent] = await connection.query(
          "SELECT id, shopkeeper_id, amount, payment_method, status, created_at FROM billing_payments ORDER BY created_at DESC LIMIT 5"
        );

        console.log('\nRecent payments:');
        recent.forEach(payment => {
          console.log(`  - ID: ${payment.id}, Shopkeeper: ${payment.shopkeeper_id}, Amount: ${payment.amount}, Status: ${payment.status}, Date: ${payment.created_at}`);
        });
      }
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

checkBillingPaymentsTable();
