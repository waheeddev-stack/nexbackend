CREATE TABLE products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_id INT,
  global_product_id INT, -- optional link to global catalog
  name VARCHAR(150),
  description TEXT,
  category VARCHAR(100),
  price DECIMAL(10,2),
  stock INT,
  image VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (shop_id) REFERENCES shopkeepers(id) ON DELETE CASCADE,
  FOREIGN KEY (global_product_id) REFERENCES global_products(id) ON DELETE SET NULL
);