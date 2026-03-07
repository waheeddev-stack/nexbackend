// Diagnose all products and their visibility
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function diagnoseProducts() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    ssl: { rejectUnauthorized: true }
  });

  try {
    console.log('🔍 Diagnosing ALL products...\n');
    
    // Get ALL products with their shop info
    const [allProducts] = await pool.query(`
      SELECT 
        p.id,
        p.name,
        p.stock,
        p.baselineQty,
        p.shop_id,
        s.shop_name,
        s.is_online,
        s.is_verified,
        s.latitude,
        s.longitude
      FROM products p
      JOIN shopkeepers s ON p.shop_id = s.id
      ORDER BY p.id DESC
    `);
    
    console.log(`Total products in database: ${allProducts.length}\n`);
    
    // Categorize products
    const withBaseline = allProducts.filter(p => p.baselineQty && p.baselineQty > 0);
    const withStock = allProducts.filter(p => p.stock && p.stock > 0);
    const visible = allProducts.filter(p => 
      p.stock > 0 && 
      p.is_online === 1 && 
      p.is_verified === 1 &&
      p.latitude && 
      p.longitude
    );
    
    console.log('📊 Summary:');
    console.log(`  Products with baselineQty > 0: ${withBaseline.length}`);
    console.log(`  Products with stock > 0: ${withStock.length}`);
    console.log(`  Products visible in NexKirana: ${visible.length}\n`);
    
    // Show products with baselineQty but stock = 0
    const needsStockReset = allProducts.filter(p => 
      p.baselineQty && p.baselineQty > 0 && 
      (!p.stock || p.stock === 0)
    );
    
    if (needsStockReset.length > 0) {
      console.log(`⚠️  ${needsStockReset.length} products have baselineQty but stock = 0:\n`);
      needsStockReset.forEach(p => {
        console.log(`  ${p.name} (${p.shop_name})`);
        console.log(`    BaselineQty: ${p.baselineQty}, Stock: ${p.stock || 0}`);
        console.log(`    Shop: ${p.is_online ? 'Online' : 'Offline'}, ${p.is_verified ? 'Verified' : 'Not Verified'}`);
      });
      console.log('');
    }
    
    // Show visible products
    if (visible.length > 0) {
      console.log(`✅ ${visible.length} products currently visible:\n`);
      visible.forEach(p => {
        console.log(`  ${p.name} (${p.shop_name})`);
        console.log(`    Stock: ${p.stock}, BaselineQty: ${p.baselineQty || 'NULL'}`);
      });
      console.log('');
    }
    
    // Check for shops that are offline or not verified
    const offlineShops = await pool.query(`
      SELECT id, shop_name, is_online, is_verified 
      FROM shopkeepers 
      WHERE is_online = 0 OR is_verified != 1
    `);
    
    if (offlineShops[0].length > 0) {
      console.log(`⚠️  ${offlineShops[0].length} shops are offline or not verified:\n`);
      offlineShops[0].forEach(s => {
        console.log(`  ${s.shop_name}: ${s.is_online ? 'Online' : 'Offline'}, ${s.is_verified ? 'Verified' : 'Not Verified'}`);
      });
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

diagnoseProducts();
