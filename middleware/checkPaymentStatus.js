import pool from "../config/db.js";

// Middleware to check if shopkeeper's payment is overdue and block access
const checkPaymentStatus = async (req, res, next) => {
  try {
    // Only apply to shopkeeper routes
    if (!req.user || !req.user.id) {
      return next();
    }

    const shopkeeper_id = req.user.id;

    // Get earnings status — correct table is billing_payments
    let earningsRows = [];
    try {
      const [rows] = await pool.query(
        "SELECT payment_status, pending_amount, next_payment_date FROM billing_payments WHERE shopkeeper_id = ? LIMIT 1",
        [shopkeeper_id]
      );
      earningsRows = rows;
    } catch (e) {
      // Fallback to legacy table name if billing_payments not yet migrated
      try {
        const [rows2] = await pool.query(
          "SELECT payment_status, pending_amount, next_payment_date FROM earnings WHERE shopkeeper_id = ? LIMIT 1",
          [shopkeeper_id]
        );
        earningsRows = rows2;
      } catch {}
    }

    // If no earnings record exists, allow access (new shopkeeper)
    if (earningsRows.length === 0) {
      return next();
    }

    const earnings = earningsRows[0];

    // Block access if payment is overdue
    if (earnings.payment_status === "blocked") {
      return res.status(403).json({
        success: false,
        message: `Payment overdue! Please pay ₹${earnings.pending_amount} to continue using the app.`,
        isBlocked: true,
        pendingAmount: earnings.pending_amount,
        nextPaymentDate: earnings.next_payment_date,
        errorCode: "PAYMENT_OVERDUE",
      });
    }

    // Allow access for other statuses
    next();
  } catch (err) {
    console.error("Payment status check error:", err);
    // Don't block on error, just log and continue
    next();
  }
};

export default checkPaymentStatus;
