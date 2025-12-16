import dotenv from 'dotenv';
import pool from '../config/db.js';

dotenv.config();

async function main() {
  try {
    console.log('Checking products in database...\n');
    
    // Get all products with their shop_id
    const [products] = await pool.query(`
      SELECT p.id, p.name, p.shop_id, p.price, p.stock, s.name as shopkeeper_name, s.shop_name
      FROM products p
      LEFT JOIN shopkeepers s ON p.shop_id = s.id
      ORDER BY p.shop_id, p.id
      LIMIT 50
    `);
    
    console.log(`Found ${products.length} products:\n`);
    
    // Group by shop_id
    const byShop = {};
    products.forEach(p => {
      const key = p.shop_id || 'NULL';
      if (!byShop[key]) byShop[key] = [];
      byShop[key].push(p);
    });
    
    for (const [shopId, prods] of Object.entries(byShop)) {
      const shopInfo = prods[0].shopkeeper_name || prods[0].shop_name || 'Unknown';
      console.log(`\nShop ID ${shopId} (${shopInfo}): ${prods.length} products`);
      prods.slice(0, 5).forEach(p => {
        console.log(`  - ${p.name} (₹${p.price}, stock: ${p.stock})`);
      });
      if (prods.length > 5) console.log(`  ... and ${prods.length - 5} more`);
    }
    
    // List all shopkeepers
    console.log('\n\n--- All Shopkeepers ---');
    const [shopkeepers] = await pool.query(`
      SELECT id, name, shop_name, email, is_verified 
      FROM shopkeepers 
      ORDER BY id DESC 
      LIMIT 20
    `);
    
    shopkeepers.forEach(s => {
      const status = s.is_verified === 1 ? '✅' : (s.is_verified === 0 ? '❌' : '⏳');
      console.log(`${status} ID ${s.id}: ${s.shop_name || s.name} (${s.email})`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
