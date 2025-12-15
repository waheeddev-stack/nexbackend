import pool from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

async function fixShopkeeperData() {
  try {
    console.log('\n=== FIXING SHOPKEEPER DATA ===\n');

    // 1. Verify all shopkeepers with valid IDs
    console.log('1. Verifying all shopkeepers...');
    await pool.query('UPDATE shopkeepers SET is_verified = 1 WHERE id IS NOT NULL AND id > 0');
    console.log('   ✅ All shopkeepers with valid IDs are now verified');

    // 2. Check orders for shopkeeper 31 (Waheed Nexkirana - has products)
    const [orders31] = await pool.query(`
      SELECT o.id, o.user_id, o.shopkeeper_id, o.status, o.total_amount, o.created_at
      FROM orders o
      WHERE o.shopkeeper_id = 31
      ORDER BY o.created_at DESC
    `);
    console.log(`\n2. Orders for Shopkeeper 31 (Waheed Nexkirana): ${orders31.length}`);
    orders31.forEach(o => {
      console.log(`   Order #${o.id}: Status=${o.status}, Amount=₹${o.total_amount}`);
    });

    // 3. Check orders for shopkeeper 24 (Waheed - has push token)
    const [orders24] = await pool.query(`
      SELECT o.id, o.user_id, o.shopkeeper_id, o.status, o.total_amount, o.created_at
      FROM orders o
      WHERE o.shopkeeper_id = 24
      ORDER BY o.created_at DESC
    `);
    console.log(`\n3. Orders for Shopkeeper 24 (Waheed): ${orders24.length}`);
    orders24.forEach(o => {
      console.log(`   Order #${o.id}: Status=${o.status}, Amount=₹${o.total_amount}`);
    });

    // 4. Show shopkeeper 31 details
    const [[shop31]] = await pool.query('SELECT * FROM shopkeepers WHERE id = 31');
    console.log('\n4. Shopkeeper 31 details:');
    console.log(`   Name: ${shop31?.name}`);
    console.log(`   Shop: ${shop31?.shop_name}`);
    console.log(`   Email: ${shop31?.email}`);
    console.log(`   Verified: ${shop31?.is_verified}`);
    console.log(`   Has Token: ${!!shop31?.expo_push_token}`);
    console.log(`   Location: ${shop31?.latitude}, ${shop31?.longitude}`);

    // 5. Show shopkeeper 24 details
    const [[shop24]] = await pool.query('SELECT * FROM shopkeepers WHERE id = 24');
    console.log('\n5. Shopkeeper 24 details:');
    console.log(`   Name: ${shop24?.name}`);
    console.log(`   Shop: ${shop24?.shop_name}`);
    console.log(`   Email: ${shop24?.email}`);
    console.log(`   Verified: ${shop24?.is_verified}`);
    console.log(`   Has Token: ${!!shop24?.expo_push_token}`);
    console.log(`   Location: ${shop24?.latitude}, ${shop24?.longitude}`);

    console.log('\n=== SUMMARY ===');
    console.log('- Products are linked to Shopkeeper 31 (Waheed Nexkirana)');
    console.log('- Orders go to Shopkeeper 31 when customers buy those products');
    console.log('- Make sure you login to the shopkeeper app with Shopkeeper 31 credentials');
    console.log(`- Shopkeeper 31 email: ${shop31?.email}`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixShopkeeperData();
