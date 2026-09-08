// public/app.js — vanilla JS SPA, no build step needed.

const el = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

// ---------- Auth ----------

async function checkSession() {
  try {
    const me = await api("/auth/me");
    showApp(me);
  } catch (_) {
    showLogin();
  }
}

function showLogin() {
  el("loginScreen").classList.remove("hidden");
  el("appScreen").classList.add("hidden");
}

function showApp(me) {
  el("loginScreen").classList.add("hidden");
  el("appScreen").classList.remove("hidden");
  el("whoami").textContent = `Signed in as ${me.username}`;
  loadDashboard();
  loadCustomers();
}

el("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  el("loginError").textContent = "";
  try {
    const me = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: el("loginUsername").value,
        password: el("loginPassword").value,
      }),
    });
    showApp(me);
  } catch (err) {
    el("loginError").textContent = err.message;
  }
});

el("logoutBtn").addEventListener("click", async () => {
  await api("/auth/logout", { method: "POST" });
  showLogin();
});

// ---------- Tabs ----------

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll("main > section").forEach((s) => s.classList.add("hidden"));
    el(`tab-${btn.dataset.tab}`).classList.remove("hidden");
    if (btn.dataset.tab === "dashboard") loadDashboard();
    if (btn.dataset.tab === "customers") loadCustomers();
  });
});

// ---------- Dashboard ----------

async function loadDashboard() {
  const d = await api("/dashboard");
  el("metrics").innerHTML = `
    ${metricCard(d.customerCount, "Customers")}
    ${metricCard(d.activeSchedules, "Active Automations")}
    ${metricCard(d.sent, "Messages Sent")}
    ${metricCard(d.pending, "Pending")}
    ${metricCard(d.failed, "Failed")}
    ${metricCard(d.repliedCustomers, "Replied")}
  `;
  el("recentMessages").innerHTML = d.recentMessages.length
    ? d.recentMessages
        .map(
          (m) => `<div class="msg-item ${m.direction === "outbound" ? "msg-outbound" : "msg-inbound"}" style="max-width:100%; margin-bottom:6px;">
            <strong>${escapeHtml(m.customer_name)}</strong> (${m.direction}, <span class="status-${m.status}">${m.status}</span>): ${escapeHtml(m.body)}
            <div class="msg-meta">${new Date(m.created_at).toLocaleString()}</div>
          </div>`
        )
        .join("")
    : `<div class="empty">No messages yet.</div>`;
}

function metricCard(num, label) {
  return `<div class="metric"><div class="num">${num}</div><div class="label">${label}</div></div>`;
}

// ---------- Customers list ----------

let customersCache = [];

async function loadCustomers() {
  customersCache = await api("/customers");
  const body = el("customerTableBody");
  el("customerEmpty").classList.toggle("hidden", customersCache.length > 0);
  body.innerHTML = customersCache
    .map(
      (c) => `<tr data-id="${c.id}" class="cust-row">
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.phone)}</td>
        <td>${escapeHtml(c.company || "—")}</td>
        <td><span class="status-pill status-${c.status}">${c.status}</span></td>
        <td>${c.rule_active ? `every ${c.interval_minutes}m, max ${c.max_followups}` : "paused"}</td>
        <td><button class="link-btn view-btn" data-id="${c.id}">View →</button></td>
      </tr>`
    )
    .join("");
  document.querySelectorAll(".view-btn").forEach((b) =>
    b.addEventListener("click", () => openDetail(b.dataset.id))
  );
}

// ---------- Add / Edit customer modal ----------

el("addCustomerBtn").addEventListener("click", () => openCustomerModal());
el("customerCancelBtn").addEventListener("click", () => el("customerModal").classList.add("hidden"));

function openCustomerModal(customer) {
  el("customerFormError").textContent = "";
  el("customerModalTitle").textContent = customer ? "Edit Customer" : "Add Customer";
  el("custId").value = customer ? customer.id : "";
  el("custName").value = customer ? customer.name : "";
  el("custPhone").value = customer ? customer.phone : "";
  el("custEmail").value = customer ? customer.email || "" : "";
  el("custCompany").value = customer ? customer.company || "" : "";
  el("custNotes").value = customer ? customer.notes || "" : "";
  el("ruleDelay").value = customer ? customer.first_message_delay_minutes ?? 0 : 0;
  el("ruleInterval").value = customer ? customer.interval_minutes ?? 2880 : 2880;
  el("ruleMax").value = customer ? customer.max_followups ?? 3 : 3;
  el("customerModal").classList.remove("hidden");
}

el("customerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  el("customerFormError").textContent = "";
  const id = el("custId").value;
  const payload = {
    name: el("custName").value,
    phone: el("custPhone").value,
    email: el("custEmail").value,
    company: el("custCompany").value,
    notes: el("custNotes").value,
    rule: {
      first_message_delay_minutes: Number(el("ruleDelay").value),
      interval_minutes: Number(el("ruleInterval").value),
      max_followups: Number(el("ruleMax").value),
    },
  };
  try {
    if (id) {
      await api(`/customers/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: payload.name, phone: payload.phone, email: payload.email,
          company: payload.company, notes: payload.notes,
        }),
      });
      await api(`/customers/${id}/rule`, { method: "PUT", body: JSON.stringify(payload.rule) });
    } else {
      await api("/customers", { method: "POST", body: JSON.stringify(payload) });
    }
    el("customerModal").classList.add("hidden");
    await loadCustomers();
    await loadDashboard();
  } catch (err) {
    el("customerFormError").textContent = err.message;
  }
});

// ---------- Detail modal ----------

let currentDetailId = null;

async function openDetail(id) {
  currentDetailId = id;
  await refreshDetail();
  el("detailModal").classList.remove("hidden");
}

async function refreshDetail() {
  const c = await api(`/customers/${currentDetailId}`);
  el("detailName").textContent = c.name;
  el("detailStatusRow").innerHTML = `
    <span class="status-pill status-${c.status}">${c.status}</span>
    &nbsp;${escapeHtml(c.phone)} ${c.company ? "· " + escapeHtml(c.company) : ""}
    ${c.rule ? `· every ${c.rule.interval_minutes}m, max ${c.rule.max_followups}, ${c.rule.is_active ? "active" : "paused"}` : ""}
  `;

  el("scheduleTableBody").innerHTML = c.schedule.length
    ? c.schedule
        .map(
          (s) => `<tr>
            <td>${s.sequence_number}</td>
            <td>${new Date(s.scheduled_at).toLocaleString()}</td>
            <td class="status-${s.status}">${s.status}</td>
            <td>${escapeHtml(s.failure_reason || s.message_text || "—")}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="4" class="empty">No slots scheduled.</td></tr>`;

  el("messageHistory").innerHTML = c.messages.length
    ? c.messages
        .map(
          (m) => `<div class="msg-item ${m.direction === "outbound" ? "msg-outbound" : "msg-inbound"}">
            ${escapeHtml(m.body)}
            <div class="msg-meta">${m.direction} · ${m.status} · ${new Date(m.created_at).toLocaleString()}</div>
          </div>`
        )
        .join("")
    : `<div class="empty">No messages yet.</div>`;

  el("editCustomerBtn").onclick = () => openCustomerModal(c);
  el("pauseBtn").onclick = async () => { await api(`/customers/${c.id}/pause`, { method: "POST" }); refreshDetail(); loadCustomers(); };
  el("resumeBtn").onclick = async () => {
    try { await api(`/customers/${c.id}/resume`, { method: "POST" }); refreshDetail(); loadCustomers(); }
    catch (err) { alert(err.message); }
  };
  el("deleteCustomerBtn").onclick = async () => {
    if (!confirm(`Delete ${c.name}? This cannot be undone.`)) return;
    await api(`/customers/${c.id}`, { method: "DELETE" });
    el("detailModal").classList.add("hidden");
    loadCustomers(); loadDashboard();
  };
}

el("detailCloseBtn").addEventListener("click", () => el("detailModal").classList.add("hidden"));

el("simulateReplyBtn").addEventListener("click", async () => {
  const text = el("simulateReplyText").value.trim();
  if (!text) return;
  await api("/webhook/whatsapp/incoming", {
    method: "POST",
    body: JSON.stringify({ customerId: currentDetailId, message: text }),
  });
  el("simulateReplyText").value = "";
  refreshDetail();
  loadCustomers();
  loadDashboard();
});

// ---------- Utils ----------

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Poll dashboard periodically so scheduled sends show up without a manual refresh.
setInterval(() => {
  if (!el("appScreen").classList.contains("hidden") && !el("tab-dashboard").classList.contains("hidden")) {
    loadDashboard();
  }
  if (currentDetailId && !el("detailModal").classList.contains("hidden")) {
    refreshDetail();
  }
}, 8000);

checkSession();
