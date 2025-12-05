import pool from "../config/db.js";

const addBillingSystem = async () => {
  try {
    console.log("🔄 Adding billing system to existing database...");

    // Add new columns to shopkeepers table
    console.log("📋 Adding billing columns to shopkeepers table...");
    
    const alterQueries = [
      "ALTER TABLE shopkeepers ADD COLUMN IF NOT EXISTS trial_ends_at DATETIME DEFAULT NULL",
      "ALTER TABLE shopkeepers ADD COLUMN IF NOT EXISTS subscription_status ENUM('trial', 'active', 'overdue', 'suspended') DEFAULT 'trial'",
      "ALTER TABLE shopkeepers ADD COLUMN IF NOT EXISTS last_payment_date DATETIME DEFAULT NULL",
      "ALTER TABLE shopkeepers ADD COLUMN IF NOT EXISTS next_payment_due DATETIME DEFAULT NULL",
      "ALTER TABLE shopkeepers MODIFY COLUMN shop_scale ENUM('small', 'medium', 'large') DEFAULT NULL"
    ];

    for (const query of alterQueries) {
      try {
        await pool.query(query);
        console.log(`✅ Executed: ${query.substring(0, 50)}...`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`⚠️  Column already exists: ${query.substring(0, 50)}...`);
        } else {
          console.error(`❌ Error executing: ${query}`, err.message);
        }
      }
    }

    // Create billing_payments table
    console.log("📋 Creating billing_payments table...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS billing_payments (
        id BIGINT(20) NOT NULL PRIMARY KEY,
        shopkeeper_id BIGINT(20) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        payment_method VARCHAR(50),
        transaction_id VARCHAR(255),
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        approved_by BIGINT(20) DEFAULT NULL,
        approved_at DATETIME DEFAULT NULL,
        notes TEXT,
        FOREIGN KEY (shopkeeper_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
      )
    `);

    // Update existing shopkeepers to have trial status
    console.log("🔄 Setting trial status for existing shopkeepers...");
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 90); // 90 days from now

    await pool.query(`
      UPDATE shopkeepers 
      SET trial_ends_at = ?, subscription_status = 'trial' 
      WHERE trial_ends_at IS NULL
    `, [trialEndDate]);

    console.log("✅ Billing system successfully added to database!");
    console.log("📊 Summary:");
    console.log("   - Added billing columns to shopkeepers table");
    console.log("   - Created billing_payments table");
    console.log("   - Set 90-day trial for existing shopkeepers");
    
  } catch (error) {
    console.error("❌ Error adding billing system:", error);
  } finally {
    process.exit(0);
  }
};

// Run the migration
addBillingSystem();