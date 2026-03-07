// Check why products with baseline_qty are not showing in NexKirana
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function checkProducts() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    ssl: { rejectUnauthorized: true }
  });

  try {
    console.log('🔍 Checking product visibility for NexKirana...\n');
    
    // Check products with baseline_qty
    const [productsWithBaseline] = await pool.query(`
      SELECT 
        p.id,
        p.name,
        p.stock,
        p.baseline_qty,
        p.shop_id,
        s.shop_name,
        s.is_online,
        s.is_verified,
        s.latitude,
        s.longitude
      FROM products p
      JOIN shopkeepers s ON p.shop_id = s.id
      WHERE p.baseline_qty IS NOT NULL AND p.baseline_qty > 0
      ORDER BY p.id DESC
      LIMIT 10
    `);
    
    console.log(`Found ${productsWithBaseline.length} products with baseline_qty set:\n`);
    
    productsWithBaseline.forEach(p => {
      console.log(`Product ID: ${p.id}`);
      console.log(`  Name: ${p.name}`);
      console.log(`  Stock: ${p.stock}`);
      console.log(`  Baseline Qty: ${p.baseline_qty}`);
      console.log(`  Shop: ${p.shop_name} (ID: ${p.shop_id})`);
      console.log(`  Shop Online: ${p.is_online}`);
      console.log(`  Shop Verified: ${p.is_verified}`);
      console.log(`  Location: ${p.latitude}, ${p.longitude}`);
      
      // Check visibility criteria
      const issues = [];
      if (p.stock <= 0) issues.push('❌ Stock is 0 or negative');
      if (p.is_online === 0) issues.push('❌ Shop is offline');
      if (p.is_verified !== 1) issues.push('❌ Shop not verified');
      if (!p.latitude || !p.longitude) issues.push('❌ Shop has no location');
      
      if (issues.length > 0) {
        console.log(`  Issues:`);
        issues.forEach(issue => console.log(`    ${issue}`));
      } else {
        console.log(`  ✅ Should be visible in NexKirana`);
      }
      console.log('---\n');
    });
    
    // Check NexKirana visibility query
    console.log('\n📊 Checking what NexKirana query would return...\n');
    
    // Simulate NexKirana query (products with stock > 0, shop online, verified, with location)
    const [visibleProducts] = await pool.query(`
      SELECT 
        p.id,
        p.name,
        p.stock,
        p.baseline_qty,
        s.shop_name,
        s.latitude,
        s.longitude
      FROM products p
      JOIN shopkeepers s ON p.shop_id = s.id
      WHERE p.stock > 0
        AND s.is_online = 1
        AND s.is_verified = 1
        AND s.latitude IS NOT NULL
        AND s.longitude IS NOT NULL
      ORDER BY p.id DESC
      LIMIT 10
    `);
    
    console.log(`NexKirana would show ${visibleProducts.length} products:\n`);
    
    visibleProducts.forEach(p => {
      console.log(`  ${p.name} (Stock: ${p.stock}, Baseline: ${p.baseline_qty || 'NULL'}) - ${p.shop_name}`);
    });
    
    if (visibleProducts.length === 0) {
      console.log('\n⚠️  NO PRODUCTS VISIBLE!');
      console.log('\nPossible reasons:');
      console.log('1. All products have stock = 0');
      console.log('2. All shops are offline (is_online = 0)');
      console.log('3. All shops are not verified (is_verified != 1)');
      console.log('4. All shops have no location (latitude/longitude NULL)');
      
      // Check each condition
      const [stockCheck] = await pool.query('SELECT COUNT(*) as count FROM products WHERE stock > 0');
      const [onlineCheck] = await pool.query('SELECT COUNT(*) as count FROM shopkeepers WHERE is_online = 1');
      const [verifiedCheck] = await pool.query('SELECT COUNT(*) as count FROM shopkeepers WHERE is_verified = 1');
      const [locationCheck] = await pool.query('SELECT COUNT(*) as count FROM shopkeepers WHERE latitude IS NOT NULL AND longitude IS NOT NULL');
      
      console.log('\nDiagnostics:');
      console.log(`  Products with stock > 0: ${stockCheck[0].count}`);
      console.log(`  Shops online: ${onlineCheck[0].count}`);
      console.log(`  Shops verified: ${verifiedCheck[0].count}`);
      console.log(`  Shops with location: ${locationCheck[0].count}`);
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkProducts();
