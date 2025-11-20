import pool from "../config/db.js";

// Script to update payment statuses (should be run daily via cron job)
const updatePaymentStatuses = async () => {
  try {
    console.log("Updating payment statuses...");

    // Update payment statuses based on next payment date
    const [result] = await pool.query(`
      UPDATE earnings 
      SET payment_status = CASE
          WHEN DATEDIFF(next_payment_date, CURDATE()) < 0 AND pending_amount > 0 THEN 'blocked'
          WHEN DATEDIFF(next_payment_date, CURDATE()) <= 2 AND pending_amount > 0 THEN 'overdue'
          WHEN DATEDIFF(next_payment_date, CURDATE()) <= 7 AND pending_amount > 0 THEN 'due_soon'
          ELSE 'active'
      END
      WHERE pending_amount > 0
    `);

    console.log(`✅ Updated ${result.affectedRows} payment statuses`);

    // Get summary of current statuses
    const [summary] = await pool.query(`
      SELECT 
        payment_status,
        COUNT(*) as count,
        SUM(pending_amount) as total_pending
      FROM earnings 
      WHERE pending_amount > 0
      GROUP BY payment_status
    `);

    console.log("📊 Current payment status summary:");
    summary.forEach(row => {
      console.log(`- ${row.payment_status}: ${row.count} shopkeepers, ₹${row.total_pending} pending`);
    });

  } catch (error) {
    console.error("❌ Error updating payment statuses:", error);
  } finally {
    process.exit(0);
  }
};

// Run the update
updatePaymentStatuses();