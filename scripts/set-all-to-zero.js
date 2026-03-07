import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function setAllToZero() {
  let connection;
  
  try {
    // SSL configuration
    const dbSsl = process.env.DB_SSL && process.env.DB_SSL.trim().toLowerCase() === "true";
    const sslConfig = dbSsl ? { rejectUnauthorized: false } : undefined;

    // Create database connection
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      port: parseInt(process.env.DB_PORT) || 4000,
      ssl: sslConfig,
      charset: 'utf8mb4'
    });

    console.log('Connected to database');

    // Get current counts before update
    const [beforeStats] = await connection.execute(`
      SELECT 
        COUNT(*) as total_products,
        SUM(CASE WHEN stock > 0 THEN 1 ELSE 0 END) as products_with_stock,
        SUM(CASE WHEN baselineQty > 0 THEN 1 ELSE 0 END) as products_with_baseline
      FROM products
    `);

    console.log('\n=== BEFORE UPDATE ===');
    console.log(`Total products: ${beforeStats[0].total_products}`);
    console.log(`Products with stock > 0: ${beforeStats[0].products_with_stock}`);
    console.log(`Products with baselineQty > 0: ${beforeStats[0].products_with_baseline}`);

    // Update all products to set stock and baselineQty to 0
    const [result] = await connection.execute(`
      UPDATE products 
      SET stock = 0, baselineQty = 0
      WHERE stock != 0 OR baselineQty != 0
    `);

    console.log('\n=== UPDATE EXECUTED ===');
    console.log(`Rows affected: ${result.affectedRows}`);

    // Verify the update
    const [afterStats] = await connection.execute(`
      SELECT 
        COUNT(*) as total_products,
        SUM(CASE WHEN stock > 0 THEN 1 ELSE 0 END) as products_with_stock,
        SUM(CASE WHEN baselineQty > 0 THEN 1 ELSE 0 END) as products_with_baseline,
        SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END) as products_stock_zero,
        SUM(CASE WHEN baselineQty = 0 THEN 1 ELSE 0 END) as products_baseline_zero
      FROM products
    `);

    console.log('\n=== AFTER UPDATE ===');
    console.log(`Total products: ${afterStats[0].total_products}`);
    console.log(`Products with stock = 0: ${afterStats[0].products_stock_zero}`);
    console.log(`Products with baselineQty = 0: ${afterStats[0].products_baseline_zero}`);
    console.log(`Products with stock > 0: ${afterStats[0].products_with_stock}`);
    console.log(`Products with baselineQty > 0: ${afterStats[0].products_with_baseline}`);

    console.log('\n✅ Successfully set all stock and baselineQty to 0');
    console.log('\nNote: Products with stock = 0 will NOT be visible to customers.');
    console.log('They will be restocked at midnight (12:00 AM) to their baselineQty values.');
    console.log('Since baselineQty is also 0, they will remain at 0 after restock.');

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log('\nDatabase connection closed');
    }
  }
}

// Run the script
setAllToZero()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
