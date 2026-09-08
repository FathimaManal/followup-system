// services/aiService.js
// Generates a context-aware WhatsApp follow-up message using an LLM.
// Wrapped so that an LLM outage/timeout/bad-key NEVER crashes the server
// or blocks a scheduled send — it just falls back to a safe template
// (this satisfies the "fault tolerance" requirement in the brief).
//
// Default provider is Groq: it has a genuinely free API tier (no card
// required, generous rate limits), unlike Anthropic/OpenAI which are
// pay-per-token. Get a free key at https://console.groq.com/keys
// Groq's API is OpenAI-compatible, so it's the same request shape.
//
// Google Gemini also has a free tier if you'd rather use that —
// see callGemini() below, just set AI_PROVIDER=gemini.

const fetch = require("node-fetch");

const AI_PROVIDER = process.env.AI_PROVIDER || "groq"; // 'groq' | 'gemini'
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

function buildPrompt(customer, sequenceNumber, maxFollowups) {
  return `You are writing a short, friendly WhatsApp follow-up message on behalf of a business.

Customer name: ${customer.name}
Company: ${customer.company || "N/A"}
Notes about this customer / prior context: ${customer.notes || "No notes provided."}
This is follow-up message #${sequenceNumber} of a maximum of ${maxFollowups}.

Write ONE short WhatsApp message (max ~350 characters, no markdown, no quotes around it) that:
- Feels personal and references the notes/context if relevant
- Gently nudges the customer to respond, without being pushy
- Sounds slightly more direct/urgent if this is a later follow-up in the sequence
- Ends with a natural, low-pressure question or call to action

Return ONLY the message text, nothing else.`;
}

function fallbackMessage(customer, sequenceNumber, maxFollowups) {
  const first = sequenceNumber === 1;
  return first
    ? `Hi ${customer.name}, just checking in about your recent inquiry${customer.company ? ` with ${customer.company}` : ""}. Let us know if you have any questions!`
    : `Hi ${customer.name}, following up again (message ${sequenceNumber}/${maxFollowups}) — we'd love to hear from you when you get a chance.`;
}

// --- Groq (free tier, OpenAI-compatible) ---
async function callGroq(prompt) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 600,
      // gpt-oss models on Groq are reasoning models — "low" keeps internal
      // reasoning tokens minimal so the token budget goes to the actual reply.
      reasoning_effort: "low",
    }),
  });
  if (!res.ok) {
    const rawText = await res.text().catch(() => "");
    let detail = rawText;
    try {
      const errBody = JSON.parse(rawText);
      detail = errBody?.error?.message || rawText;
    } catch (_) {
      /* body wasn't JSON, use raw text as-is */
    }
    throw new Error(`Groq API error: ${res.status} ${res.statusText} — ${detail || "(empty response body)"}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error(`Groq API returned no text — raw response: ${JSON.stringify(data)}`);
  }
  return text.trim();
}

// --- Google Gemini (also has a free tier) ---
async function callGemini(prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );
  if (!res.ok) {
    const rawText = await res.text().catch(() => "");
    let detail = rawText;
    try {
      const errBody = JSON.parse(rawText);
      detail = errBody?.error?.message || rawText;
    } catch (_) {
      /* body wasn't JSON, use raw text as-is */
    }
    throw new Error(`Gemini API error: ${res.status} ${res.statusText} — ${detail || "(empty response body)"}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini API returned no text");
  return text.trim();
}

/**
 * Generate a follow-up message. Never throws — always resolves to
 * { text, source: 'ai' | 'fallback' }.
 */
async function generateFollowupMessage(customer, sequenceNumber, maxFollowups) {
  const hasKey =
    (AI_PROVIDER === "groq" && GROQ_API_KEY) ||
    (AI_PROVIDER === "gemini" && GEMINI_API_KEY);

  if (!hasKey) {
    return { text: fallbackMessage(customer, sequenceNumber, maxFollowups), source: "fallback" };
  }

  const prompt = buildPrompt(customer, sequenceNumber, maxFollowups);

  try {
    const text = AI_PROVIDER === "gemini" ? await callGemini(prompt) : await callGroq(prompt);
    return { text, source: "ai" };
  } catch (err) {
    console.error("[aiService] LLM call failed, using fallback:", err.message);
    return { text: fallbackMessage(customer, sequenceNumber, maxFollowups), source: "fallback" };
  }
}

module.exports = { generateFollowupMessage };