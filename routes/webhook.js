// routes/webhook.js
//
// In mock mode this endpoint is called from the UI's "Simulate customer
// reply" button. In real mode, WhatsApp Cloud API would POST here on every
// inbound message (Meta's webhook verification (GET with hub.challenge)
// is stubbed below too, for real deployment).
const express = require("express");
const db = require("../db/db");
const { cancelPendingSchedule } = require("../scheduler/scheduleHelper");

const router = express.Router();

// Meta webhook verification handshake (used only in real WhatsApp mode).
router.get("/whatsapp/incoming", (req, res) => {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "verify_me";
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  return res.sendStatus(403);
});

// Simulated / real inbound message handler — this is the "auto-stop on reply" logic.
router.post("/whatsapp/incoming", (req, res) => {
  const { customerId, message } = req.body || {};
  if (!customerId || !message) {
    return res.status(400).json({ error: "customerId and message are required" });
  }

  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId);
  if (!customer) return res.status(404).json({ error: "Unknown customer" });

  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO messages (customer_id, direction, body, status) VALUES (?, 'inbound', ?, 'received')"
    ).run(customerId, message);

    // Reply guard: flip has_replied so the cron worker will never send
    // this customer another follow-up, even if a slot was mid-flight.
    db.prepare(
      "UPDATE customers SET has_replied = 1, status = 'replied', updated_at = datetime('now') WHERE id = ?"
    ).run(customerId);

    cancelPendingSchedule(customerId, "customer replied");
  });
  tx();

  res.json({ ok: true });
});

module.exports = router;
