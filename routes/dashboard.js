// routes/dashboard.js
const express = require("express");
const db = require("../db/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const customerCount = db.prepare("SELECT COUNT(*) AS n FROM customers").get().n;
  const activeSchedules = db
    .prepare(
      "SELECT COUNT(DISTINCT customer_id) AS n FROM followup_rules WHERE is_active = 1"
    )
    .get().n;
  const sent = db
    .prepare("SELECT COUNT(*) AS n FROM followup_schedule WHERE status = 'sent'")
    .get().n;
  const pending = db
    .prepare("SELECT COUNT(*) AS n FROM followup_schedule WHERE status = 'pending'")
    .get().n;
  const failed = db
    .prepare("SELECT COUNT(*) AS n FROM followup_schedule WHERE status = 'failed'")
    .get().n;
  const repliedCustomers = db
    .prepare("SELECT COUNT(*) AS n FROM customers WHERE has_replied = 1")
    .get().n;

  const recentMessages = db
    .prepare(
      `SELECT m.*, c.name AS customer_name
       FROM messages m JOIN customers c ON c.id = m.customer_id
       ORDER BY m.created_at DESC LIMIT 20`
    )
    .all();

  res.json({
    customerCount,
    activeSchedules,
    sent,
    pending,
    failed,
    repliedCustomers,
    recentMessages,
  });
});

module.exports = router;
