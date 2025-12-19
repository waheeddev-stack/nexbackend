import pool from '../config/db.js';

async function addSubscriptionFields() {
  const connection = await pool.getConnection();

  try {
    console.log('Adding subscription fields to shopkeepers table...');

    // Add subscription fields if they don't exist
    await connection.query(`
      ALTER TABLE shopkeepers 
      ADD COLUMN IF NOT EXISTS subscription_status ENUM('trial', 'active', 'overdue', 'suspended') DEFAULT 'trial',
      ADD COLUMN IF NOT EXISTS trial_start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS trial_end_date DATETIME,
      ADD COLUMN IF NOT EXISTS last_payment_date DATETIME,
      ADD COLUMN IF NOT EXISTS next_payment_due DATETIME,
      ADD COLUMN IF NOT EXISTS grace_period_end DATETIME
    `);

    console.log('✓ Subscription fields added successfully');

    // Update existing shopkeepers with trial dates
    await connection.query(`
      UPDATE shopkeepers 
      SET 
        trial_start_date = COALESCE(trial_start_date, created_at, NOW()),
        trial_end_date = COALESCE(trial_end_date, DATE_ADD(COALESCE(created_at, NOW()), INTERVAL 90 DAY))
      WHERE subscription_status = 'trial'
    `);

    console.log('✓ Existing shopkeepers updated with trial dates');

    console.log('\nMigration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

addSubscriptionFields().catch(console.error);
