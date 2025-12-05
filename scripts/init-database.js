import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const initDatabase = async () => {
  let connection;
  
  try {
    console.log('🚀 Initializing NexKirana Database...');
    
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
    
    // Create users table
    console.log('📋 Creating users table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        address TEXT,
        img VARCHAR(255),
        store_credits DECIMAL(10,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create shopkeepers table
    console.log('📋 Creating shopkeepers table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS shopkeepers (
        id BIGINT(20) NOT NULL PRIMARY KEY,
        name VARCHAR(512) NOT NULL,
        email VARCHAR(512) NOT NULL UNIQUE,
        password VARCHAR(512) NOT NULL,
        phone BIGINT(20),
        address VARCHAR(512),
        shop_name VARCHAR(512),
        img VARCHAR(512),
        is_verified BIGINT(20) DEFAULT 0,
        shop_scale ENUM('small', 'medium', 'large') DEFAULT NULL,
        latitude DOUBLE,
        longitude VARCHAR(512),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expo_push_token VARCHAR(512),
        upi_id VARCHAR(512),
        upi_qr VARCHAR(512),
        refresh_token VARCHAR(512),
        trial_ends_at DATETIME DEFAULT NULL,
        subscription_status ENUM('trial', 'active', 'overdue', 'suspended') DEFAULT 'trial',
        last_payment_date DATETIME DEFAULT NULL,
        next_payment_due DATETIME DEFAULT NULL
      )
    `);
    
    // Create billing_payments table
    console.log('📋 Creating billing_payments table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS billing_payments (
        id BIGINT(20) NOT NULL PRIMARY KEY,
        shopkeeper_id BIGINT(20) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        payment_method VARCHAR(50),
        transaction_id VARCHAR(255),
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        approved_by BIGINT(20) DEFAULT NULL,
        approved_at DATETIME DEFAULT NULL,
        notes TEXT,
        FOREIGN KEY (shopkeeper_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
      )
    `);

    // Create admins table
    console.log('📋 Creating admins table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS admins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create global_products table
    console.log('📋 Creating global_products table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS global_products (
        id BIGINT(20) NOT NULL PRIMARY KEY,
        name VARCHAR(512) NOT NULL,
        description TEXT,
        image VARCHAR(512),
        category VARCHAR(512),
        brand VARCHAR(100),
        barcode VARCHAR(100),
        price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        shop_scales JSON DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create products table
    console.log('📋 Creating products table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT NOT NULL,
        global_product_id INT,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        image VARCHAR(255),
        category VARCHAR(50),
        price DECIMAL(10,2) NOT NULL,
        stock INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (shop_id) REFERENCES shopkeepers(id) ON DELETE CASCADE,
        FOREIGN KEY (global_product_id) REFERENCES global_products(id) ON DELETE SET NULL
      )
    `);

    // Create orders table
    console.log('📋 Creating orders table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        shopkeeper_id INT NOT NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        status ENUM('pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled') DEFAULT 'pending',
        delivery_address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (shopkeeper_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
      )
    `);

    // Create order_items table
    console.log('📋 Creating order_items table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        product_id INT NOT NULL,
        quantity INT NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);
    
    // Get admin credentials from environment variables
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    
    if (!adminEmail || !adminPassword) {
      console.error('❌ ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required');
      return;
    }
    
    // Check if admin already exists
    const [existingAdmin] = await connection.execute(
      'SELECT id FROM admins WHERE email = ?',
      [adminEmail]
    );
    
    if (existingAdmin.length > 0) {
      console.log('👤 Admin user already exists, updating password...');
      
      // Update existing admin password
      const hashedPassword = await bcrypt.hash(adminPassword, 12);
      await connection.execute(
        'UPDATE admins SET password = ? WHERE email = ?',
        [hashedPassword, adminEmail]
      );
      
      console.log('✅ Admin password updated');
    } else {
      console.log('👤 Creating admin user...');
      
      // Create new admin user
      const hashedPassword = await bcrypt.hash(adminPassword, 12);
      await connection.execute(
        'INSERT INTO admins (email, password) VALUES (?, ?)',
        [adminEmail, hashedPassword]
      );
      
      console.log('✅ Admin user created');
    }
    
    // Verify admin login (without exposing password)
    console.log('🔐 Testing admin login...');
    const [admin] = await connection.execute(
      'SELECT * FROM admins WHERE email = ?',
      [adminEmail]
    );
    
    if (admin.length > 0) {
      const isValid = await bcrypt.compare(adminPassword, admin[0].password);
      if (isValid) {
        console.log('✅ Admin login test successful');
      } else {
        console.log('❌ Admin login test failed');
      }
    }
    
    console.log('🎉 Database initialization completed!');
    console.log('📋 Admin user configured successfully');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
};

initDatabase();