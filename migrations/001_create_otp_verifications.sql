-- Create table to hold OTP verification requests
CREATE TABLE IF NOT EXISTS otp_verifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  channel ENUM('email','sms') NOT NULL,
  recipient VARCHAR(255) NOT NULL,
  otp_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts INT DEFAULT 0,
  consumed_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (recipient),
  INDEX (user_id)
);

-- Add a simple is_verified flag to users and shopkeepers (if not present, this will error on older MySQL; run manually if needed)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_verified TINYINT(1) DEFAULT 0;

ALTER TABLE shopkeepers
  ADD COLUMN IF NOT EXISTS is_verified TINYINT(1) DEFAULT 0;
