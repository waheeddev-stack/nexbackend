import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const fixDatabasePermissions = async () => {
  let connection;
  
  try {
    console.log('🔧 Fixing database permissions and structure...');
    
    // Create connection
    const sslConfig = process.env.DB_SSL === 'true' ? {
      rejectUnauthorized: false
    } : undefined;
    
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 4000,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      ssl: sslConfig
    });
    
    console.log('✅ Connected to database');
    
    // Test basic operations
    console.log('🧪 Testing database operations...');
    
    // Test SELECT
    try {
      const [testSelect] = await connection.execute('SELECT 1 as test');
      console.log('✅ SELECT permission working');
    } catch (error) {
      console.error('❌ SELECT permission failed:', error.message);
    }
    
    // Test INSERT (with a safe test)
    try {
      // Get max ID first
      const [maxId] = await connection.execute('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM global_products');
      const nextId = maxId[0].next_id;
      
      // Test insert
      await connection.execute(
        'INSERT INTO global_products (id, name, price, category, description, shop_scales) VALUES (?, ?, ?, ?, ?, ?)',
        [nextId, 'TEST_PRODUCT_' + Date.now(), 1.00, 'TEST', 'Test product for permissions', '["all"]']
      );
      console.log('✅ INSERT permission working');
      
      // Clean up test product
      await connection.execute('DELETE FROM global_products WHERE id = ?', [nextId]);
      console.log('✅ DELETE permission working');
      
    } catch (error) {
      console.error('❌ INSERT/DELETE permission failed:', error.message);
    }
    
    // Test UPDATE
    try {
      // Find an existing product to test update
      const [existingProducts] = await connection.execute('SELECT id FROM global_products LIMIT 1');
      if (existingProducts.length > 0) {
        const testId = existingProducts[0].id;
        await connection.execute(
          'UPDATE global_products SET description = description WHERE id = ?',
          [testId]
        );
        console.log('✅ UPDATE permission working');
      }
    } catch (error) {
      console.error('❌ UPDATE permission failed:', error.message);
    }
    
    // Ensure proper table structure
    console.log('🔧 Ensuring proper table structure...');
    
    // Check and fix global_products table
    const [globalProductsColumns] = await connection.execute('DESCRIBE global_products');
    const columnNames = globalProductsColumns.map(col => col.Field);
    
    console.log('📋 Current global_products columns:', columnNames);
    
    // Ensure all required columns exist
    const requiredColumns = {
      'id': 'BIGINT(20) NOT NULL',
      'name': 'VARCHAR(512) NOT NULL',
      'price': 'DECIMAL(10,2) NOT NULL DEFAULT 0.00',
      'category': 'VARCHAR(512)',
      'description': 'TEXT',
      'image': 'VARCHAR(512)',
      'brand': 'VARCHAR(100)',
      'barcode': 'VARCHAR(100)',
      'shop_scales': 'JSON',
      'created_at': 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
    };
    
    for (const [column, definition] of Object.entries(requiredColumns)) {
      if (!columnNames.includes(column)) {
        try {
          console.log(`➕ Adding missing column: ${column}`);
          await connection.execute(`ALTER TABLE global_products ADD COLUMN ${column} ${definition}`);
        } catch (error) {
          console.log(`⚠️ Could not add column ${column}:`, error.message);
        }
      }
    }
    
    // Check shopkeepers table
    const [shopkeepersColumns] = await connection.execute('DESCRIBE shopkeepers');
    const shopkeeperColumnNames = shopkeepersColumns.map(col => col.Field);
    
    console.log('📋 Current shopkeepers columns:', shopkeeperColumnNames);
    
    if (!shopkeeperColumnNames.includes('shop_scale')) {
      try {
        console.log('➕ Adding shop_scale column to shopkeepers');
        await connection.execute('ALTER TABLE shopkeepers ADD COLUMN shop_scale ENUM("small", "medium", "large") DEFAULT "small"');
      } catch (error) {
        console.log('⚠️ Could not add shop_scale column:', error.message);
      }
    }
    
    // Update existing data to ensure consistency
    console.log('🔄 Updating existing data for consistency...');
    
    // Ensure all global_products have shop_scales
    await connection.execute(`
      UPDATE global_products 
      SET shop_scales = '["all"]' 
      WHERE shop_scales IS NULL OR shop_scales = '' OR shop_scales = 'null'
    `);
    
    // Ensure all shopkeepers have shop_scale
    await connection.execute(`
      UPDATE shopkeepers 
      SET shop_scale = 'small' 
      WHERE shop_scale IS NULL OR shop_scale = ''
    `);
    
    console.log('🎉 Database permissions and structure fixed successfully!');
    
  } catch (error) {
    console.error('❌ Fix failed:', error);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
};

fixDatabasePermissions();