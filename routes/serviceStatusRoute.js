import express from "express";
import db from "../config/db.js";
import verifyAdminToken from "../middleware/adminAuth.js";

const serviceStatusRouter = express.Router();

/**
 * GET /api/service/status
 * 
 * Public endpoint to get current service status
 * No authentication required
 * 
 * Response:
 * {
 *   status: 'online' | 'offline',
 *   message: string | null,
 *   lastUpdated: ISO8601 timestamp,
 *   updatedBy: string (admin username)
 * }
 */
serviceStatusRouter.get("/status", async (req, res) => {
  try {
    // Query the active service status with admin username
    const [rows] = await db.execute(`
      SELECT 
        ss.status,
        ss.message,
        ss.updated_at as lastUpdated,
        a.username as updatedBy
      FROM service_status ss
      LEFT JOIN admins a ON ss.updated_by = a.id
      WHERE ss.is_active = TRUE
      LIMIT 1
    `);

    // If no active status found, return default (online)
    if (!rows || rows.length === 0) {
      return res.json({
        status: 'online',
        message: null,
        lastUpdated: new Date().toISOString(),
        updatedBy: 'system'
      });
    }

    const statusRecord = rows[0];

    // Return the service status
    res.json({
      status: statusRecord.status,
      message: statusRecord.message,
      lastUpdated: statusRecord.lastUpdated.toISOString(),
      updatedBy: statusRecord.updatedBy || 'system'
    });

  } catch (error) {
    console.error('Error fetching service status:', error);
    
    // On error, return default status (online) to allow app to function
    res.status(500).json({
      status: 'online',
      message: null,
      lastUpdated: new Date().toISOString(),
      updatedBy: 'system',
      error: 'Failed to fetch status, defaulting to online'
    });
  }
});

/**
 * POST /api/service/toggle
 * 
 * Admin-only endpoint to toggle service status
 * Requires valid JWT token with admin role
 * 
 * Request Body:
 * {
 *   status: 'online' | 'offline' (required),
 *   message: string (optional, max 500 chars)
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   status: 'online' | 'offline',
 *   timestamp: ISO8601 timestamp
 * }
 */
serviceStatusRouter.post("/toggle", verifyAdminToken, async (req, res) => {
  try {
    const { status, message } = req.body;
    const adminId = req.admin?.id;

    // Validate status
    if (!status || !['online', 'offline'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be "online" or "offline"'
      });
    }

    // Validate message length
    if (message && message.length > 500) {
      return res.status(400).json({
        success: false,
        error: 'Message exceeds 500 character limit'
      });
    }

    // Get current status
    const [currentRows] = await db.execute(`
      SELECT status FROM service_status WHERE is_active = TRUE LIMIT 1
    `);
    const currentStatus = currentRows[0]?.status || 'online';

    // Check if status is already the same
    if (currentStatus === status) {
      return res.status(400).json({
        success: false,
        error: `Service is already ${status}`
      });
    }

    // Begin transaction
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Deactivate current status
      await connection.execute(`
        UPDATE service_status SET is_active = FALSE WHERE is_active = TRUE
      `);

      // Insert new status
      await connection.execute(`
        INSERT INTO service_status (status, message, updated_by, is_active, created_at, updated_at)
        VALUES (?, ?, ?, TRUE, NOW(), NOW())
      `, [status, message || null, adminId]);

      // Log to history
      await connection.execute(`
        INSERT INTO service_status_history (previous_status, new_status, message, changed_by, changed_at, ip_address, user_agent)
        VALUES (?, ?, ?, ?, NOW(), ?, ?)
      `, [
        currentStatus,
        status,
        message || null,
        adminId,
        req.ip || req.connection.remoteAddress || 'unknown',
        req.get('user-agent') || 'unknown'
      ]);

      await connection.commit();
      connection.release();

      res.json({
        success: true,
        status: status,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }

  } catch (error) {
    console.error('Error toggling service status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to toggle service status'
    });
  }
});

/**
 * GET /api/service/history
 * 
 * Admin-only endpoint to get service status history
 * Requires valid JWT token with admin role
 * 
 * Query Parameters:
 * - limit: number of records to return (default: 50, max: 500)
 * - offset: pagination offset (default: 0)
 * 
 * Response:
 * {
 *   success: boolean,
 *   history: [
 *     {
 *       id: number,
 *       previousStatus: 'online' | 'offline',
 *       newStatus: 'online' | 'offline',
 *       message: string | null,
 *       changedAt: ISO8601 timestamp,
 *       changedBy: string (admin username),
 *       ipAddress: string,
 *       userAgent: string
 *     }
 *   ],
 *   total: number,
 *   limit: number,
 *   offset: number
 * }
 */
serviceStatusRouter.get("/history", verifyAdminToken, async (req, res) => {
  try {
    let limit = parseInt(req.query.limit) || 50;
    let offset = parseInt(req.query.offset) || 0;

    // Validate limit
    if (limit < 1 || limit > 500) {
      limit = 50;
    }

    // Validate offset
    if (offset < 0) {
      offset = 0;
    }

    // Get total count
    const [countRows] = await db.execute(`
      SELECT COUNT(*) as total FROM service_status_history
    `);
    const total = countRows[0].total;

    // Get history records
    const [historyRows] = await db.execute(`
      SELECT 
        ssh.id,
        ssh.previous_status as previousStatus,
        ssh.new_status as newStatus,
        ssh.message,
        ssh.changed_at as changedAt,
        a.username as changedBy,
        ssh.ip_address as ipAddress,
        ssh.user_agent as userAgent
      FROM service_status_history ssh
      LEFT JOIN admins a ON ssh.changed_by = a.id
      ORDER BY ssh.changed_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    // Format response
    const history = historyRows.map(record => ({
      id: record.id,
      previousStatus: record.previousStatus,
      newStatus: record.newStatus,
      message: record.message,
      changedAt: record.changedAt.toISOString(),
      changedBy: record.changedBy || 'system',
      ipAddress: record.ipAddress,
      userAgent: record.userAgent
    }));

    res.json({
      success: true,
      history: history,
      total: total,
      limit: limit,
      offset: offset
    });

  } catch (error) {
    console.error('Error fetching service status history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch service status history'
    });
  }
});

export default serviceStatusRouter;
