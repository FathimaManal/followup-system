// server.js
require("dotenv").config();
const path = require("path");
const express = require("express");
const cookieSession = require("cookie-session");
const bcrypt = require("bcryptjs");

const db = require("./db/db");
const { startScheduler } = require("./scheduler/cron");

const authRoutes = require("./routes/auth");
const customerRoutes = require("./routes/customers");
const dashboardRoutes = require("./routes/dashboard");
const webhookRoutes = require("./routes/webhook");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(
  cookieSession({
    name: "session",
    keys: [process.env.SESSION_SECRET || "dev-secret-change-me"],
    maxAge: 24 * 60 * 60 * 1000,
  })
);

// --- Seed a default admin user on first boot ---
function seedAdmin() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (!existing) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hash);
    console.log(`[seed] Created default admin user "${username}" (change ADMIN_PASSWORD in .env!)`);
  }
}
seedAdmin();

// --- Routes ---
app.use("/api/auth", authRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/webhook", webhookRoutes);

// Simple health check (useful for Render/Railway/Fly deployment checks)
app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// --- Static frontend ---
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Global error handler (fault tolerance: never crash on a route error) ---
app.use((err, req, res, next) => {
  console.error("[server] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`WhatsApp follow-up system running on http://localhost:${PORT}`);
  startScheduler();
});

// Extra safety net: never let an unexpected async error kill the process.
process.on("unhandledRejection", (reason) => {
  console.error("[process] Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[process] Uncaught exception:", err);
});
