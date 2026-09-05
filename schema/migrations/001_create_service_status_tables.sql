-- ============================================================================
-- Service Status Tables Migration (Postgres / Neon)
-- ============================================================================
-- Creates service_status and service_status_history tables for service toggle feature
-- NOTE: The UUID-keyed variant (001_create_service_status_tables_postgresql.sql)
-- is superseded by this SERIAL-keyed version which matches serviceStatusRoute.js
-- (SELECT ... WHERE is_active = TRUE LIMIT 1, INSERT ... NOW()).
-- Date: February 27, 2026 (Postgres rewrite 2026-09-05)
-- ============================================================================

-- Table: service_status — current service status (online/offline)
CREATE TABLE IF NOT EXISTS service_status (
  id SERIAL PRIMARY KEY,
  status VARCHAR(10) NOT NULL DEFAULT 'online' CHECK (status IN ('online','offline')),
  message TEXT DEFAULT NULL CHECK (message IS NULL OR LENGTH(message) <= 500),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by INT NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  is_active BOOLEAN DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_service_status_status ON service_status(status);
CREATE INDEX IF NOT EXISTS idx_service_status_is_active ON service_status(is_active);
CREATE INDEX IF NOT EXISTS idx_service_status_updated_by ON service_status(updated_by);

COMMENT ON TABLE service_status IS 'Service status table - stores current online/offline state';
COMMENT ON COLUMN service_status.is_active IS 'Soft delete flag - only one active record at a time';

-- Table: service_status_history — immutable audit log of status changes
CREATE TABLE IF NOT EXISTS service_status_history (
  id SERIAL PRIMARY KEY,
  previous_status VARCHAR(10) NOT NULL CHECK (previous_status IN ('online','offline')),
  new_status VARCHAR(10) NOT NULL CHECK (new_status IN ('online','offline')),
  message TEXT DEFAULT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  changed_by INT NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  ip_address VARCHAR(45) DEFAULT NULL,
  user_agent VARCHAR(500) DEFAULT NULL,
  CONSTRAINT status_must_change CHECK (previous_status != new_status)
);
CREATE INDEX IF NOT EXISTS idx_ssh_changed_at ON service_status_history(changed_at);
CREATE INDEX IF NOT EXISTS idx_ssh_changed_by ON service_status_history(changed_by);

COMMENT ON TABLE service_status_history IS 'Immutable audit log of all service status changes';

-- updated_at auto-touch trigger (replaces MySQL ON UPDATE CURRENT_TIMESTAMP)
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_service_status_updated_at ON service_status;
CREATE TRIGGER trg_service_status_updated_at
BEFORE UPDATE ON service_status
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
