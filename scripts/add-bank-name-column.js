import pool from '../config/db.js';

async function addBankNameColumn() {
  try {
    console.log('Checking payment_info table...');
    
    // Check if table exists
    const [tables] = await pool.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'payment_info'
    `);
    
    if (tables.length === 0) {
      console.log('❌ payment_info table does not exist. Creating it...');
      await pool.query(`
        CREATE TABLE payment_info (
          id INT PRIMARY KEY AUTO_INCREMENT,
          upi_id VARCHAR(255),
          bank_account VARCHAR(255),
          bank_name VARCHAR(255),
          ifsc_code VARCHAR(255),
          account_holder VARCHAR(255),
          qr_code TEXT,
          type VARCHAR(50) DEFAULT 'admin',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ payment_info table created with bank_name column');
      return;
    }
    
    // Check if bank_name column exists
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'payment_info' 
      AND COLUMN_NAME = 'bank_name'
    `);
    
    if (columns.length === 0) {
      console.log('Adding bank_name column...');
      await pool.query(`
        ALTER TABLE payment_info 
        ADD COLUMN bank_name VARCHAR(255) AFTER bank_account
      `);
      console.log('✅ bank_name column added successfully');
    } else {
      console.log('✅ bank_name column already exists');
    }
    
    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

addBankNameColumn();
