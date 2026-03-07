// Reset stock from baselineQty for all products
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function resetStock() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    ssl: { rejectUnauthorized: true }
  });

  try {
    console.log('🔄 Resetting stock from baselineQty...\n');
    
    // Check products with baselineQty but stock = 0
    const [productsToFix] = await pool.query(`
      SELECT 
        p.id,
        p.name,
        p.stock,
        p.baselineQty,
        s.shop_name
      FROM products p
      JOIN shopkeepers s ON p.shop_id = s.id
      WHERE p.baselineQty IS NOT NULL 
        AND p.baselineQty > 0
        AND (p.stock IS NULL OR p.stock = 0)
    `);
    
    console.log(`Found ${productsToFix.length} products to fix:\n`);
    
    if (productsToFix.length === 0) {
      console.log('✅ No products need fixing!');
      return;
    }
    
    // Show first 10
    productsToFix.slice(0, 10).forEach(p => {
      console.log(`  ${p.name} (${p.shop_name})`);
      console.log(`    Current stock: ${p.stock || 0}`);
      console.log(`    BaselineQty: ${p.baselineQty}`);
      console.log('');
    });
    
    if (productsToFix.length > 10) {
      console.log(`  ... and ${productsToFix.length - 10} more\n`);
    }
    
    // Update stock = baselineQty for all products
    console.log('Updating stock...');
    const [result] = await pool.query(`
      UPDATE products 
      SET stock = baselineQty 
      WHERE baselineQty IS NOT NULL 
        AND baselineQty > 0
        AND (stock IS NULL OR stock = 0)
    `);
    
    console.log(`✅ Updated ${result.affectedRows} products\n`);
    
    // Verify
    console.log('Verifying...');
    const [verifyProducts] = await pool.query(`
      SELECT 
        p.id,
        p.name,
        p.stock,
        p.baselineQty,
        s.shop_name,
        s.is_online,
        s.is_verified
      FROM products p
      JOIN shopkeepers s ON p.shop_id = s.id
      WHERE p.stock > 0
        AND s.is_online = 1
        AND s.is_verified = 1
      LIMIT 10
    `);
    
    console.log(`\n✅ ${verifyProducts.length} products now visible in NexKirana:\n`);
    
    verifyProducts.forEach(p => {
      console.log(`  ${p.name} (${p.shop_name})`);
      console.log(`    Stock: ${p.stock}`);
      console.log('');
    });
    
    if (verifyProducts.length === 0) {
      console.log('⚠️  Still no products visible!');
      console.log('\nPossible reasons:');
      console.log('1. All shops are offline');
      console.log('2. All shops are not verified');
      console.log('3. No products have baselineQty set');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

resetStock();
