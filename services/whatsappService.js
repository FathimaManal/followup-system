// services/whatsappService.js
//
// This module is the ONLY place that talks to WhatsApp. Swap the body of
// `sendMessage` for a real WhatsApp Cloud API call (see the commented block
// below) and nothing else in the app needs to change — routes/scheduler
// only depend on this function's { success, providerId, error } contract.
//
// MOCK MODE (default): simulates network latency and an occasional
// delivery failure so the "failure logging" and "fault tolerance"
// requirements are actually exercised end-to-end without needing real
// WhatsApp Business API access (which requires Meta business verification
// that isn't realistic to get within a 1-day task).

const USE_MOCK = (process.env.WHATSAPP_MODE || "mock") === "mock";

function mockSend(toPhone, text) {
  return new Promise((resolve) => {
    const delay = 150 + Math.random() * 350;
    setTimeout(() => {
      // Simulate ~12% delivery failure rate, e.g. bad number / rate limit.
      const failed = Math.random() < 0.12;
      if (failed) {
        resolve({ success: false, error: "Simulated delivery failure (mock provider)" });
      } else {
        resolve({ success: true, providerId: `mock_${Date.now()}_${Math.floor(Math.random() * 1e6)}` });
      }
    }, delay);
  });
}

async function realSend(toPhone, text) {
  // --- Real WhatsApp Cloud API integration (uncomment + configure) ---
  // const fetch = require("node-fetch");
  // const res = await fetch(
  //   `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
  //   {
  //     method: "POST",
  //     headers: {
  //       Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
  //       "Content-Type": "application/json",
  //     },
  //     body: JSON.stringify({
  //       messaging_product: "whatsapp",
  //       to: toPhone,
  //       type: "text",
  //       text: { body: text },
  //     }),
  //   }
  // );
  // const data = await res.json();
  // if (!res.ok) return { success: false, error: data?.error?.message || `HTTP ${res.status}` };
  // return { success: true, providerId: data.messages?.[0]?.id };
  throw new Error("Real WhatsApp mode not configured — set WHATSAPP_MODE=mock or implement realSend()");
}

/**
 * Send a WhatsApp message. Never throws — always resolves to
 * { success: boolean, providerId?: string, error?: string }.
 */
async function sendMessage(toPhone, text) {
  try {
    return USE_MOCK ? await mockSend(toPhone, text) : await realSend(toPhone, text);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { sendMessage, USE_MOCK };
