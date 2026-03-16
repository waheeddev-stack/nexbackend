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
 * GET /api/admin/service/history
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
