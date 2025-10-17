CREATE TABLE shopkeepers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  shop_name VARCHAR(150),
  email VARCHAR(200) UNIQUE,
  password VARCHAR(255),
  phone VARCHAR(30),
  address TEXT,
  img VARCHAR(255),                -- URL to shopkeeper photo
  expo_push_token VARCHAR(255),    -- for push notifications
  upi_id VARCHAR(100),             -- e.g. merchant@bank
  upi_qr VARCHAR(255),            -- optional: URL to stored QR image
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
