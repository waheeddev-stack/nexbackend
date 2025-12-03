CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  shopkeeper_id INT NOT NULL,
  status ENUM('Pending','Processing','Delivered','Cancelled') DEFAULT 'Pending',
  total_amount DECIMAL(10,2) NOT NULL,
  points_discount DECIMAL(10,2) DEFAULT 0.00,
  credits_earned DECIMAL(10,2) DEFAULT 0,
  latitude DECIMAL(9,6),
  longitude DECIMAL(9,6),
  delivery_address VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (shopkeeper_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
);