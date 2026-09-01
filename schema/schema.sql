-- Database Schema for NexKirana
-- Version: 2.0
-- Generated from Documentation

CREATE TABLE IF NOT EXISTS admins (
  id INT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  address VARCHAR(255),
  img VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expo_push_token VARCHAR(255),
  store_credits INT DEFAULT 0,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  refresh_token VARCHAR(500)
);

CREATE TABLE IF NOT EXISTS shopkeepers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  shop_name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  address VARCHAR(255),
  img VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expo_push_token VARCHAR(255),
  upi_id VARCHAR(100),
  upi_qr VARCHAR(255),
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  is_verified TINYINT(1) DEFAULT NULL,
  refresh_token VARCHAR(500),
  is_online TINYINT(1) DEFAULT 1,
  is_deleted TINYINT(1) DEFAULT 0,
  deleted_at DATETIME,
  subscription_status ENUM('active','overdue','grace_period','suspended') DEFAULT 'active',
  last_payment_date DATETIME,
  next_payment_due DATETIME
);

CREATE TABLE IF NOT EXISTS global_products (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  category VARCHAR(100),
  description TEXT,
  image VARCHAR(255),
  barcode VARCHAR(255) UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id INT PRIMARY KEY AUTO_INCREMENT,
  shop_id INT NOT NULL,
  global_product_id INT,
  name VARCHAR(150),
  description TEXT,
  category VARCHAR(100),
  price DECIMAL(10,2),
  mrp DECIMAL(10,2) DEFAULT NULL,
  stock INT DEFAULT 0,
  image VARCHAR(255),
  barcode VARCHAR(255) UNIQUE,
  baselineQty INT DEFAULT 0,
  restockAt DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (shop_id) REFERENCES shopkeepers(id) ON DELETE CASCADE,
  FOREIGN KEY (global_product_id) REFERENCES global_products(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  shopkeeper_id INT NOT NULL,
  status ENUM('Pending','Processing','Delivered','Cancelled','Completed') DEFAULT 'Pending',
  payment_method ENUM('cod','upi') NOT NULL DEFAULT 'cod',
  total_amount DECIMAL(10,2) NOT NULL,
  credits_earned DECIMAL(10,2) DEFAULT 0,
  credits_used INT NOT NULL DEFAULT 0,
  credits_granted TINYINT(1) NOT NULL DEFAULT 0,
  latitude DECIMAL(9,6),
  longitude DECIMAL(9,6),
  delivery_address VARCHAR(255),
  scheduled_time DATETIME,
  order_type VARCHAR(20) DEFAULT 'pickup',
  delivery_mode VARCHAR(20) DEFAULT 'pickup',
  has_timer TINYINT(1) DEFAULT 0,
  pickup_code VARCHAR(10),
  timer_started_at DATETIME,
  timer_expires_at DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (shopkeeper_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_items (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_timers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL UNIQUE,
  pickup_code VARCHAR(6) NOT NULL,
  timer_duration INT DEFAULT 420,
  timer_started_at TIMESTAMP,
  timer_expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT FALSE,
  is_expired BOOLEAN DEFAULT FALSE,
  stopped_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

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
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS price_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  shop_id INT NOT NULL,
  old_price DECIMAL(10,2) NOT NULL,
  new_price DECIMAL(10,2) NOT NULL,
  changed_by INT,
  reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventory_alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  shop_id INT NOT NULL,
  alert_type VARCHAR(50) NOT NULL,
  threshold_value INT,
  is_active BOOLEAN DEFAULT TRUE,
  last_triggered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS barcode_scans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  barcode VARCHAR(255) NOT NULL,
  product_id INT,
  shop_id INT,
  scanned_by INT,
  scan_result VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_restoration_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  cancelled_by VARCHAR(50) NOT NULL,
  cancellation_reason TEXT,
  items_restored INT DEFAULT 0,
  total_quantity_restored INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS billing_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shopkeeper_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  payment_method VARCHAR(50) DEFAULT 'upi',
  transaction_id VARCHAR(100),
  payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  status ENUM('pending','approved','rejected') DEFAULT 'pending',
  notes TEXT,
  approved_by INT,
  approved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (shopkeeper_id) REFERENCES shopkeepers(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES admins(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payment_info (
  id INT AUTO_INCREMENT PRIMARY KEY,
  upi_id VARCHAR(100),
  upi_qr VARCHAR(500),
  bank_account VARCHAR(50),
  bank_name VARCHAR(100),
  ifsc_code VARCHAR(20),
  account_holder_name VARCHAR(100),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_status (
  id INT AUTO_INCREMENT PRIMARY KEY,
  status ENUM('online','offline') NOT NULL DEFAULT 'online',
  message VARCHAR(500),
  updated_by INT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES admins(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS service_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  previous_status ENUM('online','offline') NOT NULL,
  new_status ENUM('online','offline') NOT NULL,
  message VARCHAR(500),
  changed_by INT NOT NULL,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45),
  user_agent VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (changed_by) REFERENCES admins(id) ON DELETE RESTRICT
);
