// Check products table structure
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function checkTable() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    ssl: { rejectUnauthorized: true }
  });

  try {
    console.log('🔍 Checking products table structure...\n');
    
    // Get table structure
    const [columns] = await pool.query('SHOW COLUMNS FROM products');
    
    console.log('Products table columns:\n');
    columns.forEach(col => {
      console.log(`  ${col.Field} (${col.Type}) ${col.Null === 'YES' ? 'NULL' : 'NOT NULL'} ${col.Key ? `[${col.Key}]` : ''} ${col.Extra || ''}`);
    });
    
    // Check if baseline_qty exists
    const hasBaselineQty = columns.some(col => col.Field === 'baseline_qty');
    
    if (!hasBaselineQty) {
      console.log('\n❌ baseline_qty column does NOT exist!');
      console.log('\nThis column needs to be added for the daily restock system.');
      console.log('\nTo add it, run:');
      console.log('  ALTER TABLE products ADD COLUMN baseline_qty INT DEFAULT NULL;');
    } else {
      console.log('\n✅ baseline_qty column exists');
    }
    
    // Check sample products
    console.log('\n📊 Sample products:\n');
    const [products] = await pool.query(`
      SELECT 
        p.id,
        p.name,
        p.stock,
        p.shop_id,
        s.shop_name,
        s.is_online,
        s.is_verified
      FROM products p
      JOIN shopkeepers s ON p.shop_id = s.id
      ORDER BY p.id DESC
      LIMIT 5
    `);
    
    products.forEach(p => {
      console.log(`  ID ${p.id}: ${p.name}`);
      console.log(`    Stock: ${p.stock}`);
      console.log(`    Shop: ${p.shop_name} (${p.is_online ? 'Online' : 'Offline'}, ${p.is_verified ? 'Verified' : 'Not Verified'})`);
      console.log('');
    });
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkTable();
