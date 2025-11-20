CREATE TABLE earnings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shopkeeper_id INT NOT NULL,
  total_paid DECIMAL(10,2) DEFAULT 0.00,
  pending_amount DECIMAL(10,2) DEFAULT 0.00,
  last_payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  next_payment_date TIMESTAMP NULL,
  payment_status ENUM('active', 'due_soon', 'overdue', 'blocked') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (shopkeeper_id) REFERENCES shopkeepers(id) ON DELETE CASCADE,
  UNIQUE KEY unique_shopkeeper (shopkeeper_id)
);

-- Create earnings_history table to track payment history
CREATE TABLE earnings_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shopkeeper_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  payment_method VARCHAR(100),
  transaction_id VARCHAR(255),
  status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
  admin_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (shopkeeper_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
);

-- Create order_earnings table to track earnings per order
CREATE TABLE order_earnings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  shopkeeper_id INT NOT NULL,
  order_amount DECIMAL(10,2) NOT NULL,
  earning_amount DECIMAL(5,2) NOT NULL,
  earning_rate VARCHAR(20) NOT NULL, -- e.g., "5 (≤100)", "8 (100-300)", "15 (>300)"
  payment_cycle_start DATE NOT NULL,
  payment_cycle_end DATE NOT NULL,
  is_paid BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (shopkeeper_id) REFERENCES shopkeepers(id) ON DELETE CASCADE,
  UNIQUE KEY unique_order_earning (order_id)
);

-- Create payment_info table to store platform payment details
CREATE TABLE payment_info (
  id INT AUTO_INCREMENT PRIMARY KEY,
  upi_id VARCHAR(100),
  upi_qr VARCHAR(255), -- URL to QR code image
  bank_account VARCHAR(50),
  bank_name VARCHAR(100),
  ifsc_code VARCHAR(20),
  account_holder_name VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);