// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db/db");

const router = express.Router();

router.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  return res.json({ id: user.id, username: user.username });
});

router.post("/logout", (req, res) => {
  req.session = null;
  return res.json({ ok: true });
});

router.get("/me", (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  return res.json({ id: req.session.userId, username: req.session.username });
});

module.exports = router;
