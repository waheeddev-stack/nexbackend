-- Billing Payments Table for Shopkeeper Subscription Payments
CREATE TABLE IF NOT EXISTS billing_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shopkeeper_id INT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  payment_method VARCHAR(50) DEFAULT 'upi',
  transaction_id VARCHAR(100),
  payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  notes TEXT,
  approved_by INT,
  approved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (shopkeeper_id) REFERENCES shopkeepers(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES admins(id) ON DELETE SET NULL,
  INDEX idx_shopkeeper_id (shopkeeper_id),
  INDEX idx_status (status),
  INDEX idx_payment_date (payment_date)
);

-- Payment Info Table for Admin Payment Credentials
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

-- Add subscription fields to shopkeepers table if not exists
ALTER TABLE shopkeepers 
ADD COLUMN IF NOT EXISTS subscription_status ENUM('trial', 'active', 'overdue', 'suspended') DEFAULT 'trial',
ADD COLUMN IF NOT EXISTS last_payment_date DATETIME,
ADD COLUMN IF NOT EXISTS next_payment_due DATETIME;
