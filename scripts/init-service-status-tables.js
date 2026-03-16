import db from "../config/db.js";

/**
 * Initialize service_status and service_status_history tables
 * This script creates the necessary tables for the service toggle feature
 */

async function initServiceStatusTables() {
  try {
    console.log('🚀 Initializing Service Status Tables...\n');

    // Create service_status table
    console.log('Creating service_status table...');
    await db.execute(`
      CREATE TABLE IF NOT EXISTS \`service_status\` (
        \`id\` CHAR(36) NOT NULL COMMENT 'UUID primary key',
        \`status\` ENUM('online', 'offline') NOT NULL DEFAULT 'online' COMMENT 'Current service status',
        \`message\` TEXT DEFAULT NULL COMMENT 'Optional admin message (max 500 chars)',
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Record creation timestamp (UTC)',
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last update timestamp (UTC)',
        \`updated_by\` INT(11) NOT NULL COMMENT 'Foreign key to admin user who made the change',
        \`is_active\` TINYINT(1) DEFAULT 1 COMMENT 'Soft delete flag - only one active record at a time',
        
        PRIMARY KEY (\`id\`),
        KEY \`idx_status\` (\`status\`) COMMENT 'Index for fast status queries',
        KEY \`idx_is_active\` (\`is_active\`) COMMENT 'Index for finding current active status',
        KEY \`idx_updated_by\` (\`updated_by\`) COMMENT 'Index for audit queries by admin',
        CONSTRAINT \`fk_service_status_admin\` FOREIGN KEY (\`updated_by\`) REFERENCES \`admins\` (\`id\`) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Service status table - stores current online/offline state'
    `);
    console.log('✅ service_status table created successfully\n');

    // Create service_status_history table
    console.log('Creating service_status_history table...');
    await db.execute(`
      CREATE TABLE IF NOT EXISTS \`service_status_history\` (
        \`id\` CHAR(36) NOT NULL COMMENT 'UUID primary key',
        \`service_status_id\` CHAR(36) NOT NULL COMMENT 'Foreign key to service_status',
        \`previous_status\` ENUM('online', 'offline') NOT NULL COMMENT 'Status before change',
        \`new_status\` ENUM('online', 'offline') NOT NULL COMMENT 'Status after change',
        \`message\` TEXT DEFAULT NULL COMMENT 'Admin message provided during toggle',
        \`changed_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'When the change occurred (UTC)',
        \`changed_by\` INT(11) NOT NULL COMMENT 'Foreign key to admin user who made the change',
        \`ip_address\` VARCHAR(45) DEFAULT NULL COMMENT 'Client IP address (IPv4 or IPv6)',
        \`user_agent\` VARCHAR(500) DEFAULT NULL COMMENT 'User agent string from request',
        
        PRIMARY KEY (\`id\`),
        KEY \`idx_changed_at\` (\`changed_at\`) COMMENT 'Index for time-based queries',
        KEY \`idx_changed_by\` (\`changed_by\`) COMMENT 'Index for audit queries by admin',
        KEY \`idx_service_status_id\` (\`service_status_id\`) COMMENT 'Index for finding history of specific status',
        CONSTRAINT \`fk_history_service_status\` FOREIGN KEY (\`service_status_id\`) REFERENCES \`service_status\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_history_admin\` FOREIGN KEY (\`changed_by\`) REFERENCES \`admins\` (\`id\`) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Immutable audit log of service status changes'
    `);
    console.log('✅ service_status_history table created successfully\n');

    // Insert initial service status record
    console.log('Inserting initial service status record...');
    
    // First, get the first admin ID
    const [admins] = await db.execute('SELECT id FROM admins LIMIT 1');
    
    if (!admins || admins.length === 0) {
      console.log('⚠️  No admin found. Please create an admin first.');
      console.log('   Initial service status record not inserted.');
      process.exit(0);
    }

    const adminId = admins[0].id;
    const statusId = generateUUID();

    await db.execute(`
      INSERT INTO \`service_status\` (
        \`id\`,
        \`status\`,
        \`message\`,
        \`created_at\`,
        \`updated_at\`,
        \`updated_by\`,
        \`is_active\`
      ) VALUES (
        ?,
        'online',
        NULL,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        ?,
        1
      )
    `, [statusId, adminId]);
    
    console.log('✅ Initial service status record inserted successfully\n');

    // Verify tables were created
    console.log('Verifying tables...');
    const [tables] = await db.execute(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME IN ('service_status', 'service_status_history')
    `);

    if (tables.length === 2) {
      console.log('✅ Both tables verified successfully\n');
      console.log('📊 Service Status Tables Initialization Complete!');
      console.log('   - service_status table created');
      console.log('   - service_status_history table created');
      console.log('   - Initial status record inserted (online)');
    } else {
      console.log('❌ Table verification failed');
      process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    console.error('❌ Error initializing tables:', error.message);
    process.exit(1);
  }
}

/**
 * Generate a UUID v4
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

initServiceStatusTables();
