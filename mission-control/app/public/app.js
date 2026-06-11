// Frontend del Mission Control. Sin frameworks: fetch + DOM.
const $ = (id) => document.getElementById(id);
const api = (path, opts = {}) =>
  fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-MC-CSRF": "1", ...(opts.headers || {}) },
  });

let ME = null;

async function init() {
  const res = await api("/api/me");
  if (!res.ok) { location.href = "/login"; return; }
  ME = (await res.json()).user;
  $("who").textContent = `${ME.name} · ${ME.role}`;
  if (ME.role !== "member") $("btnUsers").hidden = false;
  if (ME.totpEnabled) $("btn2fa").textContent = "2FA ✓";
  if (ME.mustChangePassword) { alert("Por seguridad, cambia tu contraseña temporal ahora."); $("dlgPass").showModal(); }
  loadClientes();
}

// ---------------------------------------------------------------- dashboard
function semClass(s) {
  if (!s) return "";
  if (s.includes("🔴")) return "red";
  if (s.includes("🟡")) return "yellow";
  return "green";
}

function money(n) {
  return n == null ? "" : "$" + Number(n).toLocaleString("es-MX");
}

async function loadClientes() {
  const res = await api("/api/clientes");
  if (!res.ok) { $("grid").textContent = "Error cargando datos de Airtable."; return; }
  const { clientes } = await res.json();
  const activos = clientes.filter((c) => c["Cliente"]);
  const rojos = activos.filter((c) => semClass(c["Semáforo"]) === "red").length;
  const hoy = activos.reduce((s, c) => s + (c["Vencen Hoy"] || 0), 0);
  const vencidas = activos.reduce((s, c) => s + (c["Tareas Vencidas"] || 0), 0);
  const mrr = activos.reduce((s, c) => s + (c["Ticket mensual"] || 0), 0);
  $("stats").innerHTML = `
    <div class="stat"><b>${activos.length}</b>clientes</div>
    <div class="stat"><b style="color:var(--red)">${rojos}</b>en rojo</div>
    <div class="stat"><b>${hoy}</b>vencen hoy</div>
    <div class="stat"><b>${vencidas}</b>tareas vencidas</div>
    <div class="stat"><b>${money(mrr)}</b>MRR</div>`;

  activos.sort((a, b) => (b["Tareas Vencidas"] || 0) - (a["Tareas Vencidas"] || 0));
  $("grid").innerHTML = activos.map((c) => `
    <div class="cliente ${semClass(c["Semáforo"])}">
      <h3>${esc(c["Cliente"])} <span>${(c["Semáforo"] || "").slice(0, 2)}</span></h3>
      <div class="ticket">${money(c["Ticket mensual"])}/mes · ${esc(c["Status"]?.name || c["Status"] || "")}</div>
      <div class="badges">
        ${c["Vencen Hoy"] ? `<span class="badge alert">⚡ ${c["Vencen Hoy"]} hoy</span>` : ""}
        ${c["Tareas Vencidas"] ? `<span class="badge">${c["Tareas Vencidas"]} vencidas</span>` : ""}
        ${c["Tareas Abiertas"] ? `<span class="badge">${c["Tareas Abiertas"]} abiertas</span>` : ""}
      </div>
      <div class="resumen">${esc(c["Resumen del Día"] || "")}</div>
      ${c["Asana Link"] ? `<a href="${esc(c["Asana Link"])}" target="_blank" rel="noopener">Abrir en Asana →</a>` : ""}
    </div>`).join("");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// ------------------------------------------------------------------- PUNCHI
let chatHistory = [];

function addMsg(cls, text) {
  const div = document.createElement("div");
  div.className = `msg ${cls}`;
  div.textContent = text;
  $("msgs").appendChild(div);
  $("msgs").scrollTop = $("msgs").scrollHeight;
  return div;
}

$("chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("chatInput").value.trim();
  if (!text) return;
  $("chatInput").value = "";
  addMsg("user", text);
  const bot = addMsg("bot", "…");
  bot.textContent = "";

  const res = await api("/api/chat", { method: "POST", body: JSON.stringify({ message: text, history: chatHistory }) });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    bot.textContent = err.error || "PUNCHI no está disponible ahora.";
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop();
    for (const part of parts) {
      if (!part.startsWith("data: ")) continue;
      const ev = JSON.parse(part.slice(6));
      if (ev.type === "text") { bot.textContent += ev.text; $("msgs").scrollTop = $("msgs").scrollHeight; }
      else if (ev.type === "tool") addMsg("tool", `🔎 consultando ${ev.name}…`);
      else if (ev.type === "done") chatHistory = ev.messages.slice(-12);
      else if (ev.type === "error") bot.textContent += `\n⚠️ ${ev.error}`;
    }
  }
});

// ------------------------------------------------------------------ headers
$("btnOut").onclick = async () => { await api("/api/logout", { method: "POST" }); location.href = "/login"; };
$("btnPass").onclick = () => $("dlgPass").showModal();
$("cpClose").onclick = () => $("dlgPass").close();
$("cpSave").onclick = async () => {
  const res = await api("/api/change-password", {
    method: "POST",
    body: JSON.stringify({ current: $("cpCur").value, next: $("cpNew").value }),
  });
  const d = await res.json();
  $("cpOut").textContent = res.ok ? "Contraseña actualizada ✓" : d.error;
};

$("btn2fa").onclick = async () => {
  $("dlg2fa").showModal();
  const res = await api("/api/2fa/setup", { method: "POST" });
  const d = await res.json();
  $("tfSecret").textContent = `Clave: ${d.secret}`;
};
$("tfClose").onclick = () => $("dlg2fa").close();
$("tfEnable").onclick = async () => {
  const res = await api("/api/2fa/enable", { method: "POST", body: JSON.stringify({ code: $("tfCode").value }) });
  const d = await res.json();
  $("tfOut").textContent = res.ok ? "2FA activado ✓" : d.error;
};

$("btnUsers").onclick = async () => {
  $("dlgUsers").showModal();
  refreshUsers();
};
$("nuClose").onclick = () => $("dlgUsers").close();
async function refreshUsers() {
  const res = await api("/api/users");
  if (!res.ok) return;
  const { users } = await res.json();
  $("nuList").innerHTML = "<br><b>Usuarios:</b><br>" + users
    .map((u) => `${esc(u.name)} — ${esc(u.email)} (${u.role})${u.totpEnabled ? " 🔐" : ""}`)
    .join("<br>");
}
$("nuCreate").onclick = async () => {
  const res = await api("/api/users", {
    method: "POST",
    body: JSON.stringify({ email: $("nuEmail").value.trim(), name: $("nuName").value.trim(), role: $("nuRole").value }),
  });
  const d = await res.json();
  $("nuOut").textContent = res.ok
    ? `Usuario creado. Contraseña temporal (compártela en persona, se cambia al entrar): ${d.tempPassword}`
    : d.error;
  if (res.ok) refreshUsers();
};

init();
