// scheduler/cron.js
//
// The background dispatch engine. Runs every minute (configurable) and:
//   1. Finds pending slots whose scheduled_at has arrived
//   2. Atomically "claims" each slot (pending -> processing) so two
//      overlapping ticks (or two server instances) can never double-send
//   3. Re-checks the reply guard + cap + pause state right before sending
//      (belt-and-braces on top of the pre-generation checks)
//   4. Generates the AI message, attempts WhatsApp delivery, and records
//      the outcome — success -> 'sent' + audit row, failure -> 'failed'
//      + failure_reason (NEVER marked as sent)
//
// LLM and WhatsApp calls are both already fault-tolerant (see the two
// services), so a bad API key or an outage degrades gracefully instead of
// crashing this loop or the server.

const cron = require("node-cron");
const db = require("../db/db");
const { generateFollowupMessage } = require("../services/aiService");
const { sendMessage } = require("../services/whatsappService");

async function processDueSlot(slot) {
  // Atomic claim: only proceeds if this row is still 'pending'. Prevents
  // double-processing if the previous tick is still running long.
  const claim = db
    .prepare(
      "UPDATE followup_schedule SET status = 'processing', attempted_at = datetime('now') WHERE id = ? AND status = 'pending'"
    )
    .run(slot.id);
  if (claim.changes === 0) return; // someone else already claimed it

  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(slot.customer_id);
  const rule = db.prepare("SELECT * FROM followup_rules WHERE customer_id = ?").get(slot.customer_id);

  // Re-validate right before sending: reply guard, cap, pause, deleted customer.
  if (!customer || customer.has_replied || customer.status !== "active") {
    db.prepare(
      "UPDATE followup_schedule SET status = 'cancelled', failure_reason = ? WHERE id = ?"
    ).run("cancelled at send-time (customer replied/inactive)", slot.id);
    return;
  }
  if (!rule || !rule.is_active) {
    db.prepare(
      "UPDATE followup_schedule SET status = 'cancelled', failure_reason = ? WHERE id = ?"
    ).run("cancelled at send-time (automation paused)", slot.id);
    return;
  }
  if (slot.sequence_number > rule.max_followups) {
    db.prepare(
      "UPDATE followup_schedule SET status = 'cancelled', failure_reason = ? WHERE id = ?"
    ).run("cancelled at send-time (exceeds current max_followups)", slot.id);
    return;
  }

  const { text } = await generateFollowupMessage(customer, slot.sequence_number, rule.max_followups);
  const result = await sendMessage(customer.phone, text);

  const tx = db.transaction(() => {
    if (result.success) {
      db.prepare(
        "UPDATE followup_schedule SET status = 'sent', message_text = ?, sent_at = datetime('now') WHERE id = ?"
      ).run(text, slot.id);
      db.prepare(
        "INSERT INTO messages (customer_id, direction, body, status, schedule_id) VALUES (?, 'outbound', ?, 'sent', ?)"
      ).run(customer.id, text, slot.id);
    } else {
      // Failure logging requirement: explicit failed status + reason, never marked sent.
      db.prepare(
        "UPDATE followup_schedule SET status = 'failed', message_text = ?, failure_reason = ? WHERE id = ?"
      ).run(text, result.error || "Unknown delivery failure", slot.id);
      db.prepare(
        "INSERT INTO messages (customer_id, direction, body, status, schedule_id) VALUES (?, 'outbound', ?, 'failed', ?)"
      ).run(customer.id, text, slot.id);
    }
  });
  tx();
}

async function runDispatchTick() {
  let dueSlots;
  try {
    dueSlots = db
      .prepare(
        "SELECT * FROM followup_schedule WHERE status = 'pending' AND datetime(scheduled_at) <= datetime('now') ORDER BY scheduled_at ASC"
      )
      .all();
  } catch (err) {
    console.error("[scheduler] Failed to query due slots:", err.message);
    return;
  }

  if (dueSlots.length) {
    console.log(`[scheduler] tick: ${dueSlots.length} due slot(s) found`);
  }
  for (const slot of dueSlots) {
    try {
      await processDueSlot(slot);
    } catch (err) {
      // A single slot's failure must never take down the whole tick.
      console.error(`[scheduler] Error processing slot ${slot.id}:`, err.message);
      try {
        db.prepare(
          "UPDATE followup_schedule SET status = 'failed', failure_reason = ? WHERE id = ? AND status IN ('pending','processing')"
        ).run(`Internal error: ${err.message}`, slot.id);
      } catch (_) {
        /* swallow — logging best-effort */
      }
    }
  }
}

function startScheduler() {
  const expr = process.env.CRON_EXPRESSION || "*/1 * * * *"; // every minute
  console.log(`[scheduler] Starting background dispatch job (${expr})`);
  cron.schedule(expr, () => {
    runDispatchTick().catch((err) =>
      console.error("[scheduler] Unhandled tick error:", err.message)
    );
  });
}

module.exports = { startScheduler, runDispatchTick };
