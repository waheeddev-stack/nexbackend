import db from "../config/db.js";

let intervalHandle = null;

export function startTimerCleanupCron(scheduleMs = 60_000) {
  if (intervalHandle) {
    return;
  }
  intervalHandle = setInterval(async () => {
    try {
      const now = new Date();
      const [expiredTimers] = await db.query(
        `SELECT ot.order_id 
         FROM order_timers ot
         WHERE ot.is_active = TRUE AND ot.timer_expires_at < ?`,
        [now]
      ).catch(() => [[]]);

      if (expiredTimers.length > 0) {
        const orderIds = expiredTimers.map(t => t.order_id);
        await db.query(
          `UPDATE order_timers 
           SET is_active = FALSE, is_expired = TRUE
           WHERE order_id IN (${orderIds.map(() => '?').join(',')})`,
          orderIds
        );
        await db.query(
          `UPDATE orders 
           SET has_timer = FALSE
           WHERE id IN (${orderIds.map(() => '?').join(',')})`,
          orderIds
        );
        console.log(`⏱️ Timer cleanup cron: expired ${expiredTimers.length} timers`);
      }
    } catch (err) {
      console.warn(`⏱️ Timer cleanup cron error: ${err.message}`);
    }
  }, scheduleMs);
  console.log(`⏱️ Timer cleanup cron started (every ${scheduleMs / 1000}s)`);
}

export function getTimerCleanupCronStatus() {
  return {
    running: !!intervalHandle,
    intervalMs: intervalHandle ? intervalHandle._idleTimeout : null
  };
}
