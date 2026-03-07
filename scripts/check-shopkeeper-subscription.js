// Check subscription status for a specific shopkeeper
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function checkSubscription() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    ssl: { rejectUnauthorized: true }
  });

  try {
    console.log('🔍 Checking shopkeeper subscription data...\n');
    
    // Get the most recent shopkeeper
    const [shopkeepers] = await pool.query(`
      SELECT 
        id, 
        email, 
        shop_name, 
        is_verified,
        subscription_status,
        last_payment_date,
        next_payment_due,
        created_at
      FROM shopkeepers 
      ORDER BY id DESC 
      LIMIT 5
    `);
    
    console.log('Recent shopkeepers:\n');
    
    shopkeepers.forEach(s => {
      console.log(`ID: ${s.id}`);
      console.log(`Email: ${s.email}`);
      console.log(`Shop: ${s.shop_name}`);
      console.log(`Verified: ${s.is_verified}`);
      console.log(`Subscription Status: ${s.subscription_status || 'NULL'}`);
      console.log(`Last Payment: ${s.last_payment_date || 'NULL'}`);
      console.log(`Next Payment Due: ${s.next_payment_due || 'NULL'}`);
      console.log(`Created: ${s.created_at}`);
      console.log('---\n');
    });
    
    // Check if any have NULL subscription_status
    const [nullStatus] = await pool.query(`
      SELECT COUNT(*) as count 
      FROM shopkeepers 
      WHERE subscription_status IS NULL OR subscription_status = ''
    `);
    
    if (nullStatus[0].count > 0) {
      console.log(`⚠️  Found ${nullStatus[0].count} shopkeepers with NULL/empty subscription_status`);
      console.log('This might cause payment issues in the app.\n');
      console.log('Fix: Set default subscription_status to "active" for new shopkeepers');
    } else {
      console.log('✅ All shopkeepers have valid subscription_status');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkSubscription();
