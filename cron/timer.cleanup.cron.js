import db from "../config/db.js";

let intervalHandle = null;

export function startTimerCleanupCron(scheduleMs = 60_000, io = null) {
  if (intervalHandle) {
    return;
  }
  intervalHandle = setInterval(async () => {
    try {
      const now = new Date();
      const [expiredTimers] = await db
        .query(
          `SELECT ot.order_id 
         FROM order_timers ot
         WHERE ot.is_active = TRUE AND ot.timer_expires_at < ?`,
          [now]
        )
        .catch(() => [[]]);

      if (expiredTimers.length > 0) {
        const orderIds = expiredTimers.map((t) => t.order_id);
        await db.query(
          `UPDATE order_timers 
           SET is_expired = TRUE
           WHERE order_id IN (${orderIds.map(() => "?").join(",")})`,
          orderIds
        );
        if (io) {
          const placeholders = orderIds.map(() => "?").join(",");
          const [orders] = await db
            .query(
              `SELECT id, user_id, shopkeeper_id, pickup_code, timer_started_at, timer_expires_at 
             FROM orders 
             WHERE id IN (${placeholders})`,
              orderIds
            )
            .catch(() => [[]]);
          for (const o of orders) {
            const payload = {
              orderId: o.id,
              userId: o.user_id,
              shopkeeperId: o.shopkeeper_id,
              pickupCode: o.pickup_code,
              timerStartedAt: o.timer_started_at,
              timerExpiresAt: o.timer_expires_at,
              expiredAt: now.toISOString(),
            };
            const shopRoom = `shop_${Number(o.shopkeeper_id)}`;
            const customerRoom = `customer_${Number(o.user_id)}`;
            io.to(shopRoom).emit("timerExpired", payload);
            io.to(customerRoom).emit("timerExpired", payload);
            io.to("admin").emit("timerExpired", payload);
          }
        }
        console.log(
          `⏱️ Timer cleanup cron: expired ${expiredTimers.length} timers`
        );
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
    intervalMs: intervalHandle ? intervalHandle._idleTimeout : null,
  };
}
