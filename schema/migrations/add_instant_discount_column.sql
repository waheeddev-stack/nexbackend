ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS instant_discount DECIMAL(10,2) DEFAULT 0.00 COMMENT 'Instant discount amount applied at checkout (50% of tiered discount)';
