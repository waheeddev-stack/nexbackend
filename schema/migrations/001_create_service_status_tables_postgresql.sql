-- ============================================================================
-- Service Toggle Control Migration (PostgreSQL — UUID-keyed variant)
-- ============================================================================
-- NOTE: SUPERSEDED — use 001_create_service_status_tables.sql instead.
-- The runtime (routes/serviceStatusRoute.js) expects SERIAL integer ids and
-- simple is_active=TRUE row selection; this UUID variant is kept for reference.
-- ============================================================================

CREATE TYPE service_status_enum AS ENUM ('online', 'offline');

CREATE TABLE IF NOT EXISTS service_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status service_status_enum NOT NULL DEFAULT 'online',
  message TEXT DEFAULT NULL CHECK (message IS NULL OR LENGTH(message) <= 500),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_service_status_status ON service_status(status);
CREATE INDEX IF NOT EXISTS idx_service_status_is_active ON service_status(is_active);
CREATE INDEX IF NOT EXISTS idx_service_status_updated_by ON service_status(updated_by);

CREATE TABLE IF NOT EXISTS service_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_status_id UUID NOT NULL REFERENCES service_status(id) ON DELETE CASCADE,
  previous_status service_status_enum NOT NULL,
  new_status service_status_enum NOT NULL,
  message TEXT DEFAULT NULL,
  changed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  changed_by INTEGER NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  ip_address INET DEFAULT NULL,
  user_agent VARCHAR(500) DEFAULT NULL,
  CONSTRAINT status_must_change CHECK (previous_status != new_status)
);

CREATE INDEX IF NOT EXISTS idx_service_status_history_changed_at ON service_status_history(changed_at);
CREATE INDEX IF NOT EXISTS idx_service_status_history_changed_by ON service_status_history(changed_by);
CREATE INDEX IF NOT EXISTS idx_service_status_history_service_status_id ON service_status_history(service_status_id);
