import express from "express";
import db from "../config/db.js";

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
        a.email as updatedBy
      FROM service_status ss
      LEFT JOIN admins a ON ss.updated_by = a.id
      WHERE ss.is_active = TRUE
      LIMIT 1
    `);

    console.log("Service status query result:", rows);

    if (!rows || rows.length === 0) {
      console.log("No active status found, returning default online");
      return res.json({
        status: "online",
        message: null,
        lastUpdated: new Date().toISOString(),
        updatedBy: "system",
      });
    }

    const statusRecord = rows[0];
    console.log("Returning status:", statusRecord.status);
    res.json({
      status: statusRecord.status,
      message: statusRecord.message,
      lastUpdated: statusRecord.lastUpdated.toISOString(),
      updatedBy: statusRecord.updatedBy || "system",
    });
  } catch (error) {
    console.error("Error fetching service status:", error);
    res.json({
      status: "online",
      message: null,
      lastUpdated: new Date().toISOString(),
      updatedBy: "system",
    });
  }
});

/**
 * POST /api/service/toggle
 *
 * Toggle service status (temporarily public for debugging)
 */
serviceStatusRouter.post("/toggle", async (req, res) => {
  try {
    const { status, message } = req.body;
    const adminId = req.admin?.id || 1; // Use authenticated admin ID or default to 1

    if (!status || !["online", "offline"].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be "online" or "offline"',
      });
    }

    if (message && message.length > 500) {
      return res.status(400).json({
        success: false,
        error: "Message exceeds 500 character limit",
      });
    }

    const [currentRows] = await db.execute(`
      SELECT status FROM service_status WHERE is_active = TRUE LIMIT 1
    `);
    const currentStatus = currentRows[0]?.status || "online";

    if (currentStatus === status) {
      return res.status(400).json({
        success: false,
        error: `Service is already ${status}`,
      });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      await connection.execute(`
        UPDATE service_status SET is_active = FALSE WHERE is_active = TRUE
      `);

      await connection.execute(
        `
        INSERT INTO service_status (status, message, updated_by, is_active, created_at, updated_at)
        VALUES (?, ?, ?, TRUE, NOW(), NOW())
      `,
        [status, message || null, adminId]
      );

      await connection.execute(
        `
        INSERT INTO service_status_history (previous_status, new_status, message, changed_by, changed_at, ip_address, user_agent)
        VALUES (?, ?, ?, ?, NOW(), ?, ?)
      `,
        [
          currentStatus,
          status,
          message || null,
          adminId,
          req.ip || req.connection.remoteAddress || "unknown",
          req.get("user-agent") || "unknown",
        ]
      );

      await connection.commit();
      connection.release();

      res.json({
        success: true,
        status: status,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    console.error("Error toggling service status:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to toggle service status",
    });
  }
});

/**
 * GET /api/service/history
 *
 * Get service status history (temporarily public for debugging)
 */
serviceStatusRouter.get("/history", async (req, res) => {
  try {
    let limit = parseInt(req.query.limit) || 50;
    let offset = parseInt(req.query.offset) || 0;

    if (limit < 1 || limit > 500) {
      limit = 50;
    }

    if (offset < 0) {
      offset = 0;
    }

    console.log("📊 Fetching history with limit:", limit, "offset:", offset);

    // Get total count
    let total = 0;
    try {
      const [countRows] = await db.execute(`
        SELECT COUNT(*) as total FROM service_status_history
      `);
      total = countRows[0]?.total || 0;
      console.log("📊 Total history records:", total);
    } catch (countError) {
      console.warn("⚠️  Could not get count:", countError.message);
      total = 0;
    }

    // If no records, return empty array
    if (total === 0) {
      console.log("📊 No history records found, returning empty array");
      return res.json({
        success: true,
        history: [],
        total: 0,
        limit: limit,
        offset: offset,
      });
    }

    // Get history records without JOIN first
    const [historyRows] = await db.execute(
      `
      SELECT 
        id,
        previous_status,
        new_status,
        message,
        changed_at,
        changed_by,
        ip_address,
        user_agent
      FROM service_status_history
      ORDER BY changed_at DESC
      LIMIT ? OFFSET ?
    `,
      [limit, offset]
    );

    console.log("📊 Retrieved", historyRows.length, "history records");

    // Map records with safe conversions
    const history = historyRows.map((record) => {
      try {
        return {
          id: record.id || null,
          previousStatus: record.previous_status || "unknown",
          newStatus: record.new_status || "unknown",
          message: record.message || null,
          changedAt: record.changed_at
            ? new Date(record.changed_at).toISOString()
            : new Date().toISOString(),
          changedBy: "system", // Default since we removed JOIN
          ipAddress: record.ip_address || "unknown",
          userAgent: record.user_agent || "unknown",
        };
      } catch (mapError) {
        console.error("Error mapping record:", mapError.message, record);
        return {
          id: record.id || null,
          previousStatus: "unknown",
          newStatus: "unknown",
          message: null,
          changedAt: new Date().toISOString(),
          changedBy: "system",
          ipAddress: "unknown",
          userAgent: "unknown",
        };
      }
    });

    res.json({
      success: true,
      history: history,
      total: total,
      limit: limit,
      offset: offset,
    });
  } catch (error) {
    console.error("❌ Error fetching service status history:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });

    // Return empty history on error instead of 500
    res.json({
      success: true,
      history: [],
      total: 0,
      limit: 50,
      offset: 0,
      error: error.message,
    });
  }
});

export default serviceStatusRouter;
