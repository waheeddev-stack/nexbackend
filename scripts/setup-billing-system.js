import pool from '../config/db.js';

const setupBillingSystem = async () => {
  try {
    console.log('🚀 Setting up billing system...\n');

    // 1. Create billing_payments table
    console.log('📋 Creating billing_payments table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS billing_payments (
        id BIGINT(20) NOT NULL AUTO_INCREMENT PRIMARY KEY,
        shopkeeper_id BIGINT(20) NOT NULL,
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
        INDEX idx_shopkeeper_id (shopkeeper_id),
        INDEX idx_status (status),
        INDEX idx_payment_date (payment_date)
      )
    `);
    console.log('✅ billing_payments table created\n');

    // 2. Create payment_info table
    console.log('📋 Creating payment_info table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_info (
        id INT AUTO_INCREMENT PRIMARY KEY,
        upi_id VARCHAR(100),
        upi_qr VARCHAR(500),
        bank_account VARCHAR(50),
        bank_name VARCHAR(100),
        ifsc_code VARCHAR(20),
        account_holder_name VARCHAR(100),
        type VARCHAR(20) DEFAULT 'admin',
        qr_code VARCHAR(500),
        account_holder VARCHAR(100),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ payment_info table created\n');

    // 3. Check if subscription columns exist in shopkeepers table
    console.log('🔍 Checking shopkeepers table columns...');
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'shopkeepers'
      AND COLUMN_NAME IN ('subscription_status', 'last_payment_date', 'next_payment_due', 'trial_start_date', 'trial_end_date', 'grace_period_end')
    `);

    const existingColumns = columns.map(c => c.COLUMN_NAME);
    console.log('Existing subscription columns:', existingColumns);

    // 4. Add subscription columns if they don't exist
    if (!existingColumns.includes('subscription_status')) {
      console.log('➕ Adding subscription_status column...');
      await pool.query(`
        ALTER TABLE shopkeepers 
        ADD COLUMN subscription_status ENUM('trial', 'active', 'overdue', 'suspended') DEFAULT 'trial'
      `);
      console.log('✅ subscription_status column added');
    }

    if (!existingColumns.includes('trial_start_date')) {
      console.log('➕ Adding trial_start_date column...');
      await pool.query(`
        ALTER TABLE shopkeepers 
        ADD COLUMN trial_start_date DATETIME DEFAULT CURRENT_TIMESTAMP
      `);
      console.log('✅ trial_start_date column added');
    }

    if (!existingColumns.includes('trial_end_date')) {
      console.log('➕ Adding trial_end_date column...');
      await pool.query(`
        ALTER TABLE shopkeepers 
        ADD COLUMN trial_end_date DATETIME
      `);
      console.log('✅ trial_end_date column added');
    }

    if (!existingColumns.includes('last_payment_date')) {
      console.log('➕ Adding last_payment_date column...');
      await pool.query(`
        ALTER TABLE shopkeepers 
        ADD COLUMN last_payment_date DATETIME
      `);
      console.log('✅ last_payment_date column added');
    }

    if (!existingColumns.includes('next_payment_due')) {
      console.log('➕ Adding next_payment_due column...');
      await pool.query(`
        ALTER TABLE shopkeepers 
        ADD COLUMN next_payment_due DATETIME
      `);
      console.log('✅ next_payment_due column added');
    }

    if (!existingColumns.includes('grace_period_end')) {
      console.log('➕ Adding grace_period_end column...');
      await pool.query(`
        ALTER TABLE shopkeepers 
        ADD COLUMN grace_period_end DATETIME
      `);
      console.log('✅ grace_period_end column added');
    }

    // 5. Initialize trial dates for existing shopkeepers
    console.log('\n🔄 Initializing trial periods for existing shopkeepers...');
    const [result] = await pool.query(`
      UPDATE shopkeepers 
      SET trial_start_date = COALESCE(trial_start_date, created_at),
          trial_end_date = COALESCE(trial_end_date, DATE_ADD(created_at, INTERVAL 90 DAY)),
          subscription_status = COALESCE(subscription_status, 'trial')
      WHERE trial_start_date IS NULL OR trial_end_date IS NULL
    `);
    console.log(`✅ Updated ${result.affectedRows} shopkeeper(s)\n`);

    // 6. Verify tables
    console.log('🔍 Verifying tables...');
    const [billingTable] = await pool.query("SHOW TABLES LIKE 'billing_payments'");
    const [paymentInfoTable] = await pool.query("SHOW TABLES LIKE 'payment_info'");
    
    console.log('✅ billing_payments table:', billingTable.length > 0 ? 'EXISTS' : 'MISSING');
    console.log('✅ payment_info table:', paymentInfoTable.length > 0 ? 'EXISTS' : 'MISSING');

    // 7. Show summary
    console.log('\n📊 Summary:');
    console.log('   ✅ billing_payments table created');
    console.log('   ✅ payment_info table created');
    console.log('   ✅ Subscription columns added to shopkeepers');
    console.log('   ✅ Trial periods initialized');
    console.log('\n🎉 Billing system setup complete!');
    console.log('\n📝 Next steps:');
    console.log('   1. Restart your backend server');
    console.log('   2. Refresh your admin panel');
    console.log('   3. Payment requests will now appear when shopkeepers submit them');

    process.exit(0);
  } catch (err) {
    console.error('❌ Error setting up billing system:', err);
    console.error('Error details:', err.message);
    process.exit(1);
  }
};

setupBillingSystem();
