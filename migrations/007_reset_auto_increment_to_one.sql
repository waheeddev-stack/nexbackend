-- ============================================================================
-- Migration 007: Reset all auto-increments / sequences to start from 1
-- Supports both MySQL (TiDB) and Postgres (Neon)
-- Date: 2026-09-01
-- ============================================================================

-- ---------------- MySQL / TiDB ----------------
-- Run these on TiDB Cloud if still using MySQL:
-- ALTER TABLE admins AUTO_INCREMENT = 1;
-- ALTER TABLE users AUTO_INCREMENT = 1;
-- ALTER TABLE shopkeepers AUTO_INCREMENT = 1;
-- ALTER TABLE global_products AUTO_INCREMENT = 1;
-- ALTER TABLE products AUTO_INCREMENT = 1;
-- ALTER TABLE orders AUTO_INCREMENT = 1;
-- ALTER TABLE order_items AUTO_INCREMENT = 1;
-- ALTER TABLE inventory_logs AUTO_INCREMENT = 1;
-- ALTER TABLE price_history AUTO_INCREMENT = 1;
-- ALTER TABLE inventory_alerts AUTO_INCREMENT = 1;
-- ALTER TABLE barcode_scans AUTO_INCREMENT = 1;
-- ALTER TABLE stock_restoration_log AUTO_INCREMENT = 1;
-- ALTER TABLE billing_payments AUTO_INCREMENT = 1;
-- ALTER TABLE payment_info AUTO_INCREMENT = 1;
-- ALTER TABLE service_status AUTO_INCREMENT = 1;
-- ALTER TABLE service_status_history AUTO_INCREMENT = 1;
-- ALTER TABLE shopping_lists AUTO_INCREMENT = 1;
-- ALTER TABLE shop_suggestions AUTO_INCREMENT = 1;
-- ALTER TABLE support_tickets AUTO_INCREMENT = 1;
-- ALTER TABLE refer_transaction AUTO_INCREMENT = 1;

-- ---------------- Postgres (Neon) ----------------
-- On Neon Postgres, SERIAL sequences are reset. Safe to run repeatedly.
-- Will set next value to 1 if table empty, or MAX(id)+1 if data exists.

DO $$
DECLARE
  tbl TEXT;
  seq TEXT;
BEGIN
  FOR tbl IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  LOOP
    seq := pg_get_serial_sequence(tbl, 'id');
    IF seq IS NOT NULL THEN
      EXECUTE format('SELECT setval(%L, GREATEST(1, COALESCE((SELECT MAX(id) FROM %I), 0) + 1), false)', seq, tbl);
      RAISE NOTICE 'Sequence % for table % reset', seq, tbl;
    END IF;
  END LOOP;
END $$;

-- Explicit restart for core tables (ensures fresh DB starts at 1)
-- These statements are idempotent; they will fail silently if sequence missing, so wrap in DO
DO $$
BEGIN
  PERFORM setval('admins_id_seq', 1, false) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='admins_id_seq');
  PERFORM setval('users_id_seq', 1, false) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='users_id_seq');
  PERFORM setval('shopkeepers_id_seq', 1, false) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='shopkeepers_id_seq');
  PERFORM setval('global_products_id_seq', 1, false) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='global_products_id_seq');
  PERFORM setval('products_id_seq', 1, false) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='products_id_seq');
  PERFORM setval('orders_id_seq', 1, false) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='orders_id_seq');
  PERFORM setval('order_items_id_seq', 1, false) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='order_items_id_seq');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Some sequences not yet created — skipping explicit RESTART';
END $$;

-- For a completely fresh start (TRUNCATE + RESTART):
-- TRUNCATE admins, users, shopkeepers, global_products, products, orders, order_items RESTART IDENTITY CASCADE;
-- Then re-run the DO block above.

