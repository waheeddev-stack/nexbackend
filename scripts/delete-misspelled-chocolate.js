import pool from '../config/db.js';

/**
 * Delete misspelled "choclates" product from database
 * Keeps the correctly spelled "chocolate" product
 */

async function deleteMisspelledChocolate() {
  try {
    console.log('🔍 Searching for chocolate products...\n');

    // First, find all chocolate-related products
    const [products] = await pool.query(
      `SELECT id, name, shop_id, price, stock, created_at 
       FROM products 
       WHERE LOWER(name) LIKE '%choc%'
       ORDER BY name`
    );

    if (products.length === 0) {
      console.log('❌ No chocolate products found in database');
      await pool.end();
      return;
    }

    console.log(`Found ${products.length} chocolate product(s):\n`);
    products.forEach((p, index) => {
      console.log(`${index + 1}. ID: ${p.id} | Name: "${p.name}" | Shop: ${p.shop_id} | Price: ₹${p.price} | Stock: ${p.stock}`);
    });

    // Find the misspelled one
    const misspelled = products.find(p => p.name.toLowerCase().includes('choclate'));
    
    if (!misspelled) {
      console.log('\n✅ No misspelled "choclates" found. Database is clean!');
      await pool.end();
      return;
    }

    console.log(`\n⚠️  Found misspelled product: "${misspelled.name}" (ID: ${misspelled.id})`);

    // Check if this product is used in any orders
    const [orderItems] = await pool.query(
      `SELECT COUNT(*) as count FROM order_items WHERE product_id = ?`,
      [misspelled.id]
    );

    const usedInOrders = orderItems[0].count;

    if (usedInOrders > 0) {
      console.log(`\n⚠️  WARNING: This product is used in ${usedInOrders} order(s)`);
      console.log('Deleting it will affect order history.');
      console.log('\nOptions:');
      console.log('1. Delete product and keep order items (recommended)');
      console.log('2. Delete product and all related order items (destructive)');
      console.log('3. Cancel operation');
      
      // For safety, we'll just delete the product, not the order items
      console.log('\n✅ Proceeding with option 1 (safe deletion)...');
    }

    // Delete the misspelled product
    const [result] = await pool.query(
      `DELETE FROM products WHERE id = ?`,
      [misspelled.id]
    );

    if (result.affectedRows > 0) {
      console.log(`\n✅ Successfully deleted misspelled product: "${misspelled.name}" (ID: ${misspelled.id})`);
      console.log(`   Rows affected: ${result.affectedRows}`);
      
      // Show remaining chocolate products
      const [remaining] = await pool.query(
        `SELECT id, name, shop_id, price, stock 
         FROM products 
         WHERE LOWER(name) LIKE '%choc%'
         ORDER BY name`
      );
      
      if (remaining.length > 0) {
        console.log(`\n✅ Remaining chocolate products (${remaining.length}):`);
        remaining.forEach((p, index) => {
          console.log(`${index + 1}. ID: ${p.id} | Name: "${p.name}" | Shop: ${p.shop_id} | Price: ₹${p.price} | Stock: ${p.stock}`);
        });
      }
    } else {
      console.log('\n❌ Failed to delete product');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    await pool.end();
    console.log('\n✅ Database connection closed');
  }
}

// Run the script
deleteMisspelledChocolate();
