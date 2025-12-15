import pool from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

async function debugShopkeeperOrders() {
  try {
    console.log('\n=== SHOPKEEPER DEBUG ===\n');

    // 1. Check all shopkeepers
    const [shopkeepers] = await pool.query(
      'SELECT id, name, email, shop_name, is_verified, expo_push_token FROM shopkeepers'
    );
    console.log('📋 All Shopkeepers:');
    shopkeepers.forEach(s => {
      console.log(`  ID: ${s.id}, Name: ${s.name}, Shop: ${s.shop_name}, Verified: ${s.is_verified}, Has Token: ${!!s.expo_push_token}`);
    });

    // 2. Check products and their shop_id
    const [products] = await pool.query(
      'SELECT id, name, shop_id, price, stock FROM products LIMIT 10'
    );
    console.log('\n📦 Products (first 10):');
    products.forEach(p => {
      console.log(`  ID: ${p.id}, Name: ${p.name}, Shop ID: ${p.shop_id}, Price: ${p.price}, Stock: ${p.stock}`);
    });

    // 3. Check orders
    const [orders] = await pool.query(
      'SELECT id, user_id, shopkeeper_id, status, total_amount, created_at FROM orders ORDER BY created_at DESC LIMIT 10'
    );
    console.log('\n🛒 Recent Orders (last 10):');
    if (orders.length === 0) {
      console.log('  No orders found!');
    } else {
      orders.forEach(o => {
        console.log(`  Order #${o.id}: User ${o.user_id} -> Shopkeeper ${o.shopkeeper_id}, Status: ${o.status}, Amount: ₹${o.total_amount}`);
      });
    }

    // 4. Check if products are linked to verified shopkeepers
    const [linkedProducts] = await pool.query(`
      SELECT p.id, p.name, p.shop_id, s.name as shopkeeper_name, s.is_verified
      FROM products p
      LEFT JOIN shopkeepers s ON p.shop_id = s.id
      LIMIT 10
    `);
    console.log('\n🔗 Products linked to Shopkeepers:');
    linkedProducts.forEach(p => {
      const status = p.is_verified === 1 ? '✅' : (p.is_verified === 0 ? '❌' : '⏳');
      console.log(`  Product "${p.name}" -> Shopkeeper: ${p.shopkeeper_name || 'NONE'} (ID: ${p.shop_id}) ${status}`);
    });

    console.log('\n=== DEBUG COMPLETE ===\n');
    
    // Suggestions
    console.log('💡 SUGGESTIONS:');
    const unverified = shopkeepers.filter(s => s.is_verified !== 1);
    if (unverified.length > 0) {
      console.log(`  - ${unverified.length} shopkeeper(s) are NOT verified. Run:`);
      unverified.forEach(s => {
        console.log(`    UPDATE shopkeepers SET is_verified = 1 WHERE id = ${s.id};`);
      });
    }
    
    const productsWithoutShop = products.filter(p => !p.shop_id);
    if (productsWithoutShop.length > 0) {
      console.log(`  - ${productsWithoutShop.length} product(s) have no shop_id assigned`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

debugShopkeeperOrders();
