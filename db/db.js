

const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "app.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  company TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',      -- active | paused | replied | completed
  has_replied INTEGER NOT NULL DEFAULT 0,      -- reply guard flag
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One automation "rule" configuration per customer.
CREATE TABLE IF NOT EXISTS followup_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  first_message_delay_minutes INTEGER NOT NULL DEFAULT 0,
  interval_minutes INTEGER NOT NULL DEFAULT 2880,  -- default: every 2 days
  max_followups INTEGER NOT NULL DEFAULT 3,
  is_active INTEGER NOT NULL DEFAULT 1,             -- manual pause/stop toggle
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every planned follow-up "slot" is pre-generated as a row here.
-- This is what makes idempotency easy: the scheduler only ever
-- transitions existing rows, it never "decides on the fly" to send,
-- so two overlapping cron ticks can't both fire the same slot.
CREATE TABLE IF NOT EXISTS followup_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL,           -- 1, 2, 3 ... up to max_followups
  scheduled_at TEXT NOT NULL,                 -- ISO datetime this should fire
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | processing | sent | failed | cancelled
  message_text TEXT,
  attempted_at TEXT,
  sent_at TEXT,
  failure_reason TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,            -- customerId:sequence_number
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_schedule_due
  ON followup_schedule (status, scheduled_at);

-- Full audit trail of every WhatsApp message, in or out.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,                    -- outbound | inbound
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',        -- sent | failed | received
  schedule_id INTEGER REFERENCES followup_schedule(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

module.exports = db;
