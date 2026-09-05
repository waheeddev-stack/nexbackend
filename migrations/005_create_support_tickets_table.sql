-- ============================================================================
-- Support Tickets Table Migration (Postgres / Neon)
-- ============================================================================
-- Creates support_tickets table for shopkeeper support ticket system

CREATE TABLE IF NOT EXISTS support_tickets (
  id SERIAL PRIMARY KEY,
  shopkeeper_id BIGINT NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  category VARCHAR(20) NOT NULL DEFAULT 'other' CHECK (category IN ('order','payment','technical','account','other')),
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  admin_response TEXT,
  responded_by BIGINT,
  responded_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (shopkeeper_id) REFERENCES shopkeepers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_shopkeeper_id ON support_tickets(shopkeeper_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON support_tickets(created_at);

-- updated_at auto-touch trigger (replaces MySQL ON UPDATE CURRENT_TIMESTAMP)
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_support_tickets_updated_at ON support_tickets;
CREATE TRIGGER trg_support_tickets_updated_at
BEFORE UPDATE ON support_tickets
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
