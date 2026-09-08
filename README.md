# AI-Powered WhatsApp Customer Follow-up System

A full-stack app where a business user logs in, adds customers, sets a
follow-up cadence per customer, and the system automatically sends
AI-generated WhatsApp follow-ups on schedule — stopping the moment the
customer replies.

## Stack & why

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js + Express | Single language end-to-end, minimal boilerplate, fast to build under a deadline |
| Database | SQLite (`better-sqlite3`) | Zero external setup (no Postgres/Mongo to provision), synchronous API keeps transaction logic simple, still a proper relational schema with foreign keys |
| Scheduler | `node-cron` | Runs an in-process background job every minute — no separate worker infra needed for this scope |
| Frontend | Plain HTML/CSS/vanilla JS, served statically by Express | No build step/bundler to fight with; keeps setup to `npm install && npm start` |
| AI | Groq or Google Gemini chat completion (configurable) | Both have genuinely free API tiers (no card required) — unlike Anthropic/OpenAI, which are pay-per-token. Groq's API is OpenAI-compatible and runs Llama models very fast |
| WhatsApp | Mock provider by default, real WhatsApp Cloud API stubbed in | Real WhatsApp Business API requires Meta business verification that isn't obtainable same-day; the mock is a well-documented drop-in module (`services/whatsappService.js`) so swapping to real is a single function |

## Local setup

```bash
npm install
cp .env.example .env
# edit .env if you want: set an AI key, change admin password, etc.
npm start
```

App runs at `http://localhost:3000`. Log in with the seeded admin account
(default `admin` / `admin123`, from `.env` — **change this** before deploying
anywhere public).

### Environment variables (`.env`)

| Var | Purpose |
|---|---|
| `PORT` | Server port (default 3000) |
| `SESSION_SECRET` | Cookie session signing secret |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Seeded on first boot if no users exist |
| `CRON_EXPRESSION` | How often the dispatcher checks for due follow-ups (default: every minute) |
| `AI_PROVIDER` | `groq` (default) or `gemini` — both free, no card required |
| `GROQ_API_KEY` / `GEMINI_API_KEY` | LLM credentials. Get a free Groq key at console.groq.com/keys or a free Gemini key at aistudio.google.com/apikey. **If left blank, the system automatically falls back to a template message instead of crashing** — see "Fault tolerance" below |
| `WHATSAPP_MODE` | `mock` (default) or `real` |
| `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` | Only needed if `WHATSAPP_MODE=real` |

## Architecture

```
customer + rule created
        │
        ▼
scheduleHelper.regenerateSchedule()
   pre-generates N "slot" rows in followup_schedule
   (sequence 1..max_followups, each with a computed scheduled_at
    and a unique dedupe_key = "customerId:sequenceNumber")
        │
        ▼
cron.js runs every minute
   SELECT slots WHERE status='pending' AND scheduled_at <= now
        │
        ▼
   for each slot: atomically claim it
   (UPDATE ... SET status='processing' WHERE status='pending')
   → only one process/tick can ever win this row
        │
        ▼
   re-check reply guard + pause + cap right before sending
        │
        ├─ blocked → status='cancelled'
        │
        ▼
   aiService.generateFollowupMessage()   (never throws — falls back
                                          to a template on LLM failure)
        │
        ▼
   whatsappService.sendMessage()         (never throws — returns
                                          {success:false, error} on failure)
        │
        ├─ success → slot.status='sent', audit row in `messages`
        └─ failure → slot.status='failed' + failure_reason,
                      audit row in `messages` (status='failed')
                      — NEVER marked as sent
```

### Why pre-generating slots (rather than computing "what's next" live)

Pre-generating every slot up front is what makes **idempotency** and **cap
enforcement** simple and provable: the scheduler never invents a send
decision on the fly, it only ever transitions rows that already exist,
each with a unique `dedupe_key`. Two overlapping cron ticks (or, in a
multi-instance deployment, two server instances) can't double-send,
because the claim step (`UPDATE ... WHERE status='pending'`) is atomic —
whichever process's UPDATE actually matches a row wins it; the other
gets `changes: 0` and moves on.

### Auto-stop on reply

`POST /api/webhook/whatsapp/incoming` (real WhatsApp Cloud API would call
this same endpoint) marks the customer `has_replied = 1` and cancels every
`pending` slot for them in one transaction. The scheduler also
re-checks `has_replied` immediately before sending, so even a slot that
was mid-flight when the reply landed will not go out.

### Fault tolerance

- LLM calls (`services/aiService.js`) are wrapped in try/catch — a bad key,
  timeout, or outage falls back to a template message rather than blocking
  the send or crashing the process.
- WhatsApp calls (`services/whatsappService.js`) never throw — they resolve
  `{ success: false, error }`, which the scheduler logs as an explicit
  `failed` status (never silently marked `sent`).
- Each scheduled slot is processed in its own try/catch inside the cron
  tick, so one bad slot can't take down the rest of that tick.
- A global Express error handler plus `process.on('uncaughtException'/
  'unhandledRejection')` guards are in place as a last resort.

### Database schema

- `users` — login accounts
- `customers` — customer profiles + `has_replied` (reply-guard flag) + `status`
- `followup_rules` — one row per customer: delay, interval, max follow-ups, active/paused
- `followup_schedule` — the pre-generated slots (the audit trail of *what was planned*)
- `messages` — the audit trail of *what actually happened* (every inbound/outbound message)

## Using the app

1. Log in.
2. **Customers → + Add Customer.** Fill in details + notes (this is what
   the AI uses for context) and a cadence. For a quick demo, set the
   interval to **1–2 minutes** instead of the 2-day default.
3. Open the customer to see the generated schedule slots update from
   `pending → sent` as the background job runs (polls every 8s in the UI).
4. Use **"Simulate customer reply"** on the detail view to fire the mock
   inbound-webhook and watch remaining slots flip to `cancelled`.
5. **Pause/Resume** on the detail view is the manual override — it stops
   dispatch immediately regardless of the schedule.
6. **Dashboard** tab shows live counts (customers, active automations,
   sent/pending/failed) and a recent activity feed.

## Mocking details

`services/whatsappService.js` simulates network latency and a ~12%
delivery failure rate so that the failure-logging path is actually
exercised in a demo, not just theoretical. To go live: set
`WHATSAPP_MODE=real`, fill in `WHATSAPP_PHONE_NUMBER_ID` /
`WHATSAPP_ACCESS_TOKEN`, and uncomment the real API call block in that
file — no other file needs to change.

## Deployment

Deployed Link : https://followup-system.onrender.com
Demo video Link : https://drive.google.com/file/d/1vMvs0HtAh8rMJmZZJMiFfwbSIb3-OKkD/view?usp=sharing

## What I'd add with more time

- Real WhatsApp Cloud API + Meta webhook signature verification
- Multi-user roles / team accounts (currently single shared admin login)
- Timezone-aware scheduling display in the UI
- Rate limiting on the auth endpoint

  







