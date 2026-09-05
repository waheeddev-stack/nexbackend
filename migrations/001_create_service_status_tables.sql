-- ============================================================================
-- Service Status Tables Migration (Postgres / Neon)
-- ============================================================================
-- Creates service_status and service_status_history tables for service toggle control

-- Service Status Table
CREATE TABLE IF NOT EXISTS service_status (
  id SERIAL PRIMARY KEY,
  status VARCHAR(10) NOT NULL DEFAULT 'online' CHECK (status IN ('online','offline')),
  message VARCHAR(500),
  updated_by INT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (updated_by) REFERENCES admins(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_service_status_is_active ON service_status(is_active);
CREATE INDEX IF NOT EXISTS idx_service_status_updated_at ON service_status(updated_at);

-- Insert default online status if table is empty (INSERT IGNORE equivalent)
INSERT INTO service_status (status, message, is_active)
SELECT 'online', NULL, TRUE
WHERE NOT EXISTS (SELECT 1 FROM service_status WHERE is_active = TRUE);

-- Service Status History Table
CREATE TABLE IF NOT EXISTS service_status_history (
  id SERIAL PRIMARY KEY,
  previous_status VARCHAR(10) NOT NULL CHECK (previous_status IN ('online','offline')),
  new_status VARCHAR(10) NOT NULL CHECK (new_status IN ('online','offline')),
  message VARCHAR(500),
  changed_by INT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address VARCHAR(45),
  user_agent VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (changed_by) REFERENCES admins(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_ssh_changed_at ON service_status_history(changed_at);
CREATE INDEX IF NOT EXISTS idx_ssh_changed_by ON service_status_history(changed_by);
CREATE INDEX IF NOT EXISTS idx_ssh_new_status ON service_status_history(new_status);
