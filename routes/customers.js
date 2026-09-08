// routes/customers.js
const express = require("express");
const db = require("../db/db");
const { requireAuth } = require("../middleware/auth");
const { regenerateSchedule, cancelPendingSchedule } = require("../scheduler/scheduleHelper");

const router = express.Router();
router.use(requireAuth);

const DEFAULT_RULE = {
  first_message_delay_minutes: 0,
  interval_minutes: 2880, // 2 days
  max_followups: 3,
};

// --- List / Create ---

router.get("/", (req, res) => {
  const customers = db
    .prepare(
      `SELECT c.*, r.first_message_delay_minutes, r.interval_minutes, r.max_followups, r.is_active AS rule_active
       FROM customers c
       LEFT JOIN followup_rules r ON r.customer_id = c.id
       ORDER BY c.created_at DESC`
    )
    .all();
  res.json(customers);
});

router.post("/", (req, res) => {
  const { name, phone, email, company, notes, rule } = req.body || {};
  if (!name || !phone) {
    return res.status(400).json({ error: "name and phone are required" });
  }

  const r = { ...DEFAULT_RULE, ...(rule || {}) };

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO customers (name, phone, email, company, notes) VALUES (?, ?, ?, ?, ?)`
      )
      .run(name, phone, email || null, company || null, notes || null);
    const customerId = info.lastInsertRowid;

    db.prepare(
      `INSERT INTO followup_rules (customer_id, first_message_delay_minutes, interval_minutes, max_followups, is_active)
       VALUES (?, ?, ?, ?, 1)`
    ).run(customerId, r.first_message_delay_minutes, r.interval_minutes, r.max_followups);

    regenerateSchedule(customerId);
    return customerId;
  });

  const customerId = tx();
  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId);
  res.status(201).json(customer);
});

// --- Get one (with rule + schedule + message history) ---

router.get("/:id", (req, res) => {
  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id);
  if (!customer) return res.status(404).json({ error: "Not found" });

  const rule = db
    .prepare("SELECT * FROM followup_rules WHERE customer_id = ?")
    .get(req.params.id);
  const schedule = db
    .prepare(
      "SELECT * FROM followup_schedule WHERE customer_id = ? ORDER BY sequence_number ASC"
    )
    .all(req.params.id);
  const messages = db
    .prepare("SELECT * FROM messages WHERE customer_id = ? ORDER BY created_at ASC")
    .all(req.params.id);

  res.json({ ...customer, rule, schedule, messages });
});

// --- Update customer fields ---

router.put("/:id", (req, res) => {
  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id);
  if (!customer) return res.status(404).json({ error: "Not found" });

  const { name, phone, email, company, notes, status } = req.body || {};
  db.prepare(
    `UPDATE customers SET
       name = COALESCE(?, name),
       phone = COALESCE(?, phone),
       email = COALESCE(?, email),
       company = COALESCE(?, company),
       notes = COALESCE(?, notes),
       status = COALESCE(?, status),
       updated_at = datetime('now')
     WHERE id = ?`
  ).run(name, phone, email, company, notes, status, req.params.id);

  if (status && status !== "active") {
    cancelPendingSchedule(req.params.id, `customer status set to ${status}`);
  }

  const updated = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id);
  res.json(updated);
});

// --- Update follow-up rule (and regenerate future slots) ---

router.put("/:id/rule", (req, res) => {
  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id);
  if (!customer) return res.status(404).json({ error: "Not found" });

  const { first_message_delay_minutes, interval_minutes, max_followups } = req.body || {};

  db.prepare(
    `UPDATE followup_rules SET
       first_message_delay_minutes = COALESCE(?, first_message_delay_minutes),
       interval_minutes = COALESCE(?, interval_minutes),
       max_followups = COALESCE(?, max_followups)
     WHERE customer_id = ?`
  ).run(first_message_delay_minutes, interval_minutes, max_followups, req.params.id);

  regenerateSchedule(req.params.id);

  const rule = db.prepare("SELECT * FROM followup_rules WHERE customer_id = ?").get(req.params.id);
  res.json(rule);
});

// --- Manual pause / resume (override at any time) ---

router.post("/:id/pause", (req, res) => {
  db.prepare("UPDATE followup_rules SET is_active = 0 WHERE customer_id = ?").run(req.params.id);
  cancelPendingSchedule(req.params.id, "manually paused by user");
  res.json({ ok: true });
});

router.post("/:id/resume", (req, res) => {
  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id);
  if (!customer) return res.status(404).json({ error: "Not found" });
  if (customer.has_replied) {
    return res.status(400).json({ error: "Cannot resume: customer has already replied" });
  }
  db.prepare("UPDATE followup_rules SET is_active = 1 WHERE customer_id = ?").run(req.params.id);
  regenerateSchedule(req.params.id);
  res.json({ ok: true });
});

// --- Delete ---

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM customers WHERE id = ?").run(req.params.id); // cascades via FK
  res.json({ ok: true });
});

module.exports = router;
