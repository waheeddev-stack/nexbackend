-- ============================================================================
-- Service Toggle Control Migration (PostgreSQL)
-- ============================================================================
-- Creates service_status and service_status_history tables for service toggle feature
-- Date: February 27, 2026
-- Database: PostgreSQL
-- ============================================================================

-- ============================================================================
-- Create ENUM types
-- ============================================================================
CREATE TYPE service_status_enum AS ENUM ('online', 'offline');

-- ============================================================================
-- Table: service_status
-- Description: Current service status (online/offline)
-- ============================================================================
CREATE TABLE IF NOT EXISTS service_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status service_status_enum NOT NULL DEFAULT 'online',
  message TEXT DEFAULT NULL CHECK (message IS NULL OR LENGTH(message) <= 500),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  is_active BOOLEAN DEFAULT TRUE,
  
  CONSTRAINT only_one_active_status UNIQUE (is_active) WHERE is_active = TRUE
);

-- Create indexes for performance
CREATE INDEX idx_service_status_status ON service_status(status);
CREATE INDEX idx_service_status_is_active ON service_status(is_active);
CREATE INDEX idx_service_status_updated_by ON service_status(updated_by);

-- Add table comments
COMMENT ON TABLE service_status IS 'Service status table - stores current online/offline state';
COMMENT ON COLUMN service_status.id IS 'UUID primary key';
COMMENT ON COLUMN service_status.status IS 'Current service status';
COMMENT ON COLUMN service_status.message IS 'Optional admin message (max 500 chars)';
COMMENT ON COLUMN service_status.created_at IS 'Record creation timestamp (UTC)';
COMMENT ON COLUMN service_status.updated_at IS 'Last update timestamp (UTC)';
COMMENT ON COLUMN service_status.updated_by IS 'Foreign key to admin user who made the change';
COMMENT ON COLUMN service_status.is_active IS 'Soft delete flag - only one active record at a time';

-- ============================================================================
-- Table: service_status_history
-- Description: Immutable audit log of all service status changes
-- ============================================================================
CREATE TABLE IF NOT EXISTS service_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_status_id UUID NOT NULL REFERENCES service_status(id) ON DELETE CASCADE,
  previous_status service_status_enum NOT NULL,
  new_status service_status_enum NOT NULL,
  message TEXT DEFAULT NULL,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  changed_by INTEGER NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  ip_address INET DEFAULT NULL,
  user_agent VARCHAR(500) DEFAULT NULL,
  
  CONSTRAINT status_must_change CHECK (previous_status != new_status)
);

-- Create indexes for performance
CREATE INDEX idx_service_status_history_changed_at ON service_status_history(changed_at);
CREATE INDEX idx_service_status_history_changed_by ON service_status_history(changed_by);
CREATE INDEX idx_service_status_history_service_status_id ON service_status_history(service_status_id);

-- Add table comments
COMMENT ON TABLE service_status_history IS 'Immutable audit log of service status changes';
COMMENT ON COLUMN service_status_history.id IS 'UUID primary key';
COMMENT ON COLUMN service_status_history.service_status_id IS 'Foreign key to service_status';
COMMENT ON COLUMN service_status_history.previous_status IS 'Status before change';
COMMENT ON COLUMN service_status_history.new_status IS 'Status after change';
COMMENT ON COLUMN service_status_history.message IS 'Admin message provided during toggle';
COMMENT ON COLUMN service_status_history.changed_at IS 'When the change occurred (UTC)';
COMMENT ON COLUMN service_status_history.changed_by IS 'Foreign key to admin user who made the change';
COMMENT ON COLUMN service_status_history.ip_address IS 'Client IP address (IPv4 or IPv6)';
COMMENT ON COLUMN service_status_history.user_agent IS 'User agent string from request';

-- ============================================================================
-- Initial Data
-- ============================================================================
-- Insert initial service status record (service is online by default)
-- Note: This assumes at least one admin exists with id = 1
-- ============================================================================

-- Uncomment to insert initial data:
-- INSERT INTO service_status (status, message, updated_by, is_active)
-- VALUES ('online', NULL, 1, TRUE)
-- ON CONFLICT DO NOTHING;

-- ============================================================================
-- Migration Complete
-- ============================================================================
