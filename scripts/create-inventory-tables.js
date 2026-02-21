import db from '../config/db.js';

async function createInventoryTables() {
  console.log('🔧 Creating Inventory Tables...\n');
  
  try {
    // 1. Add barcode to products
    console.log('📦 Adding barcode column to products...');
    try {
      await db.query('ALTER TABLE products ADD COLUMN barcode VARCHAR(255)');
      console.log('✅ Barcode column added to products');
    } catch (e) {
      if (e.message.includes('Duplicate column')) {
        console.log('⚠️  Barcode column already exists in products');
      } else {
        throw e;
      }
    }
    
    // Add unique index for products.barcode
    try {
      await db.query('CREATE UNIQUE INDEX idx_products_barcode ON products(barcode)');
      console.log('✅ Unique index created on products.barcode');
    } catch (e) {
      if (e.message.includes('Duplicate key')) {
        console.log('⚠️  Index already exists on products.barcode');
      } else {
        console.log('⚠️  Could not create unique index:', e.message);
      }
    }
    
    // 2. Add barcode to global_products
    console.log('\n📦 Adding barcode column to global_products...');
    try {
      await db.query('ALTER TABLE global_products ADD COLUMN barcode VARCHAR(255)');
      console.log('✅ Barcode column added to global_products');
    } catch (e) {
      if (e.message.includes('Duplicate column')) {
        console.log('⚠️  Barcode column already exists in global_products');
      } else {
        throw e;
      }
    }
    
    // Add unique index for global_products.barcode
    try {
      await db.query('CREATE UNIQUE INDEX idx_global_products_barcode ON global_products(barcode)');
      console.log('✅ Unique index created on global_products.barcode');
    } catch (e) {
      if (e.message.includes('Duplicate key')) {
        console.log('⚠️  Index already exists on global_products.barcode');
      } else {
        console.log('⚠️  Could not create unique index:', e.message);
      }
    }
    
    // 3. Create inventory_logs
    console.log('\n📊 Creating inventory_logs table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS inventory_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT NOT NULL,
        shop_id INT NOT NULL,
        action VARCHAR(50) NOT NULL,
        quantity INT NOT NULL,
        previous_stock INT NOT NULL,
        new_stock INT NOT NULL,
        performed_by INT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_product_id (product_id),
        INDEX idx_shop_id (shop_id),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ inventory_logs table created');
    
    // 4. Create price_history
    console.log('📊 Creating price_history table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS price_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT NOT NULL,
        shop_id INT NOT NULL,
        old_price DECIMAL(10, 2) NOT NULL,
        new_price DECIMAL(10, 2) NOT NULL,
        changed_by INT,
        reason VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_product_id (product_id),
        INDEX idx_shop_id (shop_id),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ price_history table created');
    
    // 5. Create inventory_alerts
    console.log('📊 Creating inventory_alerts table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS inventory_alerts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT NOT NULL,
        shop_id INT NOT NULL,
        alert_type VARCHAR(50) NOT NULL,
        threshold_value INT,
        is_active BOOLEAN DEFAULT TRUE,
        last_triggered_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_product_id (product_id),
        INDEX idx_shop_id (shop_id),
        INDEX idx_is_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ inventory_alerts table created');
    
    // 6. Create barcode_scans
    console.log('📊 Creating barcode_scans table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS barcode_scans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        barcode VARCHAR(255) NOT NULL,
        product_id INT,
        shop_id INT,
        scanned_by INT,
        scan_result VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_barcode (barcode),
        INDEX idx_product_id (product_id),
        INDEX idx_shop_id (shop_id),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ barcode_scans table created');
    
    // Verify
    console.log('\n🔍 Verifying tables...');
    const tables = ['inventory_logs', 'price_history', 'inventory_alerts', 'barcode_scans'];
    for (const table of tables) {
      const [rows] = await db.query(`SELECT COUNT(*) as count FROM ${table}`);
      console.log(`  ✅ ${table} - ${rows[0].count} records`);
    }
    
    console.log('\n🎉 All inventory tables created successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

createInventoryTables();
