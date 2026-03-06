/**
 * Reset all products baselineQty to 0
 * This allows shopkeepers to manually set baseline quantities as needed
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

async function resetBaselineQuantities() {
  let connection;
  
  try {
    console.log('🔄 Connecting to database...');
    
    const config = {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'nexkirana',
      port: process.env.DB_PORT || 3306
    };

    // Add SSL configuration if required (for TiDB Cloud)
    if (process.env.DB_SSL === 'true') {
      config.ssl = {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
      };
    }

    connection = await mysql.createConnection(config);

    console.log('✅ Connected to database');

    // Get current baseline quantities count
    const [beforeStats] = await connection.query(`
      SELECT 
        COUNT(*) as total_products,
        COUNT(CASE WHEN baselineQty > 0 THEN 1 END) as products_with_baseline,
        COUNT(CASE WHEN baselineQty = 0 OR baselineQty IS NULL THEN 1 END) as products_without_baseline
      FROM products
    `);

    console.log('\n📊 Current Status:');
    console.log(`   Total Products: ${beforeStats[0].total_products}`);
    console.log(`   With Baseline (>0): ${beforeStats[0].products_with_baseline}`);
    console.log(`   Without Baseline (0 or NULL): ${beforeStats[0].products_without_baseline}`);

    // Show some examples of products with baseline
    if (beforeStats[0].products_with_baseline > 0) {
      const [examples] = await connection.query(`
        SELECT id, name, shop_id, baselineQty, stock
        FROM products
        WHERE baselineQty > 0
        LIMIT 5
      `);
      
      console.log('\n📦 Examples of products with baseline:');
      examples.forEach(p => {
        console.log(`   - ${p.name} (ID: ${p.id}, Shop: ${p.shop_id}): baseline=${p.baselineQty}, stock=${p.stock}`);
      });
    }

    // Reset all baselineQty to 0
    console.log('\n🔄 Resetting all baselineQty to 0...');
    
    const [result] = await connection.query(`
      UPDATE products 
      SET baselineQty = 0 
      WHERE baselineQty IS NULL OR baselineQty != 0
    `);

    console.log(`✅ Updated ${result.affectedRows} products`);

    // Verify the update
    const [afterStats] = await connection.query(`
      SELECT 
        COUNT(*) as total_products,
        COUNT(CASE WHEN baselineQty > 0 THEN 1 END) as products_with_baseline,
        COUNT(CASE WHEN baselineQty = 0 OR baselineQty IS NULL THEN 1 END) as products_without_baseline
      FROM products
    `);

    console.log('\n📊 After Reset:');
    console.log(`   Total Products: ${afterStats[0].total_products}`);
    console.log(`   With Baseline (>0): ${afterStats[0].products_with_baseline}`);
    console.log(`   Without Baseline (0 or NULL): ${afterStats[0].products_without_baseline}`);

    console.log('\n✅ All products now have baselineQty = 0');
    console.log('📝 Shopkeepers can now manually set baseline quantities as needed');

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Database connection closed');
    }
  }
}

// Run the script
resetBaselineQuantities()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
