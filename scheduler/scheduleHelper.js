// scheduler/scheduleHelper.js
// Pre-generates the follow-up "slots" for a customer as soon as a rule is
// created/updated. The cron worker never invents send times on the fly —
// it only ever looks at rows that already exist here — which is what
// makes idempotency/dedup straightforward (see followup_schedule.dedupe_key).

const db = require("../db/db");

function toIsoFromMinutesFromNow(minutes) {
  const d = new Date(Date.now() + minutes * 60 * 1000);
  return d.toISOString();
}

/**
 * Wipe any still-pending schedule rows for a customer and regenerate them
 * from the customer's current rule. Sent/failed/cancelled rows (history)
 * are left untouched — only 'pending' slots are safe to regenerate.
 */
function regenerateSchedule(customerId) {
  const rule = db
    .prepare("SELECT * FROM followup_rules WHERE customer_id = ?")
    .get(customerId);
  if (!rule) return;

  const deleteStale = db.prepare(
    "DELETE FROM followup_schedule WHERE customer_id = ? AND status = 'pending'"
  );
  const insert = db.prepare(`
    INSERT INTO followup_schedule
      (customer_id, sequence_number, scheduled_at, status, dedupe_key)
    VALUES (?, ?, ?, 'pending', ?)
  `);

  const tx = db.transaction(() => {
    deleteStale.run(customerId);

    if (!rule.is_active) return; // paused: no future slots

    const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId);
    if (!customer || customer.has_replied || customer.status !== "active") return;

    // Don't re-create slots for sequence numbers that were already sent/failed.
    const doneSeqs = new Set(
      db
        .prepare(
          "SELECT sequence_number FROM followup_schedule WHERE customer_id = ? AND status IN ('sent','failed')"
        )
        .all(customerId)
        .map((r) => r.sequence_number)
    );

    for (let seq = 1; seq <= rule.max_followups; seq++) {
      if (doneSeqs.has(seq)) continue;
      const delayMinutes =
        seq === 1
          ? rule.first_message_delay_minutes
          : rule.first_message_delay_minutes + (seq - 1) * rule.interval_minutes;
      const scheduledAt = toIsoFromMinutesFromNow(delayMinutes);
      const dedupeKey = `${customerId}:${seq}`;
      // INSERT OR IGNORE-equivalent via unique constraint; dedupeKey guarantees
      // we can never double-insert the same slot even if this runs twice.
      try {
        insert.run(customerId, seq, scheduledAt, dedupeKey);
      } catch (e) {
        // UNIQUE constraint hit — slot already exists, safe to ignore.
      }
    }
  });

  tx();
}

/** Cancel all pending slots for a customer (manual stop, or reply guard). */
function cancelPendingSchedule(customerId, reason) {
  db.prepare(
    "UPDATE followup_schedule SET status = 'cancelled', failure_reason = ? WHERE customer_id = ? AND status = 'pending'"
  ).run(reason || "cancelled", customerId);
}

module.exports = { regenerateSchedule, cancelPendingSchedule };
