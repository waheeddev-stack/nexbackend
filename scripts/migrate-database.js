import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const migrateDatabase = async () => {
  let connection;
  
  try {
    console.log('🚀 Starting database migration...');
    
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
    
    // Check current table structure
    console.log('🔍 Checking current table structures...');
    
    // Check global_products table structure
    try {
      const [globalProductsColumns] = await connection.execute('DESCRIBE global_products');
      console.log('📋 Current global_products columns:', globalProductsColumns.map(col => col.Field));
      
      const hasShopScales = globalProductsColumns.some(col => col.Field === 'shop_scales');
      const hasPrice = globalProductsColumns.some(col => col.Field === 'price');
      const hasTieredPricing = globalProductsColumns.some(col => col.Field === 'basic_price');
      
      if (!hasShopScales) {
        console.log('➕ Adding shop_scales column to global_products...');
        await connection.execute('ALTER TABLE global_products ADD COLUMN shop_scales JSON DEFAULT NULL');
      }
      
      if (!hasPrice) {
        console.log('➕ Adding price column to global_products...');
        await connection.execute('ALTER TABLE global_products ADD COLUMN price DECIMAL(10,2) NOT NULL DEFAULT 0.00');
      }
      
      // Remove tiered pricing columns if they exist
      if (hasTieredPricing) {
        console.log('🗑️ Removing old tiered pricing columns...');
        try {
          await connection.execute('ALTER TABLE global_products DROP COLUMN basic_price');
        } catch (e) { console.log('basic_price column not found or already removed'); }
        try {
          await connection.execute('ALTER TABLE global_products DROP COLUMN premium_price');
        } catch (e) { console.log('premium_price column not found or already removed'); }
        try {
          await connection.execute('ALTER TABLE global_products DROP COLUMN enterprise_price');
        } catch (e) { console.log('enterprise_price column not found or already removed'); }
      }
      
      // Add brand and barcode if missing
      const hasBrand = globalProductsColumns.some(col => col.Field === 'brand');
      const hasBarcode = globalProductsColumns.some(col => col.Field === 'barcode');
      
      if (!hasBrand) {
        console.log('➕ Adding brand column to global_products...');
        await connection.execute('ALTER TABLE global_products ADD COLUMN brand VARCHAR(50) DEFAULT NULL');
      }
      
      if (!hasBarcode) {
        console.log('➕ Adding barcode column to global_products...');
        await connection.execute('ALTER TABLE global_products ADD COLUMN barcode VARCHAR(50) DEFAULT NULL');
      }
      
    } catch (error) {
      console.error('❌ Error checking global_products table:', error.message);
    }
    
    // Check shopkeepers table structure
    try {
      const [shopkeepersColumns] = await connection.execute('DESCRIBE shopkeepers');
      console.log('📋 Current shopkeepers columns:', shopkeepersColumns.map(col => col.Field));
      
      const hasShopScale = shopkeepersColumns.some(col => col.Field === 'shop_scale');
      const hasShopTier = shopkeepersColumns.some(col => col.Field === 'shop_tier');
      
      if (!hasShopScale) {
        console.log('➕ Adding shop_scale column to shopkeepers...');
        await connection.execute('ALTER TABLE shopkeepers ADD COLUMN shop_scale ENUM("small", "medium", "large") DEFAULT "small"');
      }
      
      // Remove shop_tier if it exists (old tiered system)
      if (hasShopTier) {
        console.log('🗑️ Removing old shop_tier column...');
        try {
          await connection.execute('ALTER TABLE shopkeepers DROP COLUMN shop_tier');
        } catch (e) { console.log('shop_tier column not found or already removed'); }
      }
      
    } catch (error) {
      console.error('❌ Error checking shopkeepers table:', error.message);
    }
    
    // Update existing global_products to have default shop_scales
    console.log('🔄 Updating existing global_products with default shop_scales...');
    try {
      await connection.execute(`
        UPDATE global_products 
        SET shop_scales = '["all"]' 
        WHERE shop_scales IS NULL OR shop_scales = ''
      `);
      console.log('✅ Updated existing products with default shop_scales');
    } catch (error) {
      console.error('❌ Error updating existing products:', error.message);
    }
    
    // Update existing shopkeepers to have default shop_scale
    console.log('🔄 Updating existing shopkeepers with default shop_scale...');
    try {
      await connection.execute(`
        UPDATE shopkeepers 
        SET shop_scale = 'small' 
        WHERE shop_scale IS NULL OR shop_scale = ''
      `);
      console.log('✅ Updated existing shopkeepers with default shop_scale');
    } catch (error) {
      console.error('❌ Error updating existing shopkeepers:', error.message);
    }
    
    // Verify final structure
    console.log('🔍 Verifying final table structures...');
    
    const [finalGlobalProducts] = await connection.execute('DESCRIBE global_products');
    console.log('📋 Final global_products structure:', finalGlobalProducts.map(col => `${col.Field} (${col.Type})`));
    
    const [finalShopkeepers] = await connection.execute('DESCRIBE shopkeepers');
    console.log('📋 Final shopkeepers structure:', finalShopkeepers.map(col => `${col.Field} (${col.Type})`));
    
    console.log('🎉 Database migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Database migration failed:', error);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
};

migrateDatabase();