import express from "express";
import db from "../config/db.js";
import verifyAdminToken from "../middleware/adminAuth.js";

const serviceStatusRouter = express.Router();

/**
 * GET /api/service/status
 * 
 * Public endpoint to get current service status
 * No authentication required
 */
serviceStatusRouter.get("/status", async (req, res) => {
  try {
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

    if (!rows || rows.length === 0) {
      return res.json({
        status: 'online',
        message: null,
        lastUpdated: new Date().toISOString(),
        updatedBy: 'system'
      });
    }

    const statusRecord = rows[0];
    res.json({
      status: statusRecord.status,
      message: statusRecord.message,
      lastUpdated: statusRecord.lastUpdated.toISOString(),
      updatedBy: statusRecord.updatedBy || 'system'
    });

  } catch (error) {
    console.error('Error fetching service status:', error);
    res.json({
      status: 'online',
      message: null,
      lastUpdated: new Date().toISOString(),
      updatedBy: 'system'
    });
  }
});

/**
 * POST /api/service/toggle
 * 
 * Toggle service status (Admin only)
 */
serviceStatusRouter.post("/toggle", verifyAdminToken, async (req, res) => {
  try {
    const { status, message } = req.body;
    const adminId = req.admin.id; // Get admin ID from authenticated token

    if (!status || !['online', 'offline'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be "online" or "offline"'
      });
    }

    if (message && message.length > 500) {
      return res.status(400).json({
        success: false,
        error: 'Message exceeds 500 character limit'
      });
    }

    const [currentRows] = await db.execute(`
      SELECT status FROM service_status WHERE is_active = TRUE LIMIT 1
    `);
    const currentStatus = currentRows[0]?.status || 'online';

    if (currentStatus === status) {
      return res.status(400).json({
        success: false,
        error: `Service is already ${status}`
      });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      await connection.execute(`
        UPDATE service_status SET is_active = FALSE WHERE is_active = TRUE
      `);

      await connection.execute(`
        INSERT INTO service_status (status, message, updated_by, is_active, created_at, updated_at)
        VALUES (?, ?, ?, TRUE, NOW(), NOW())
      `, [status, message || null, adminId]);

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
      error: error.message || 'Failed to toggle service status'
    });
  }
});

/**
 * GET /api/service/history
 * 
 * Get service status history (Admin only)
 */
serviceStatusRouter.get("/history", verifyAdminToken, async (req, res) => {
  try {
    let limit = parseInt(req.query.limit) || 50;
    let offset = parseInt(req.query.offset) || 0;

    if (limit < 1 || limit > 500) {
      limit = 50;
    }

    if (offset < 0) {
      offset = 0;
    }

    const [countRows] = await db.execute(`
      SELECT COUNT(*) as total FROM service_status_history
    `);
    const total = countRows[0].total;

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
      error: error.message || 'Failed to fetch service status history'
    });
  }
});

export default serviceStatusRouter;
