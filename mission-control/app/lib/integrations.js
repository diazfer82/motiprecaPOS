// Conectores a las fuentes de datos de Punch (Airtable + Asana).
// Todo corre del lado del servidor: los tokens jamás llegan al navegador.

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || "appXZ3KMsdvv5tVmg";
const T_CLIENTES = "tblreG0OGeYKvFxLh";
const T_ENTREGABLES = "tblijsmfpt03eN3GH";
const T_EQUIPO = "tblbOetOUnRAHWeB6";
const T_METRICAS = "tblTB8R0IlmKyN3pV";

async function api(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url.split("?")[0]} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// ----------------------------------------------------------------- Airtable

function atHeaders() {
  return { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` };
}

export async function airtableList(tableId, params = {}) {
  const records = [];
  let offset;
  do {
    const qs = new URLSearchParams({ pageSize: "100", ...params });
    if (offset) qs.set("offset", offset);
    const body = await api(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/${tableId}?${qs}`,
      atHeaders()
    );
    records.push(...body.records);
    offset = body.offset;
  } while (offset);
  return records;
}

export const tables = {
  clientes: T_CLIENTES,
  entregables: T_ENTREGABLES,
  equipo: T_EQUIPO,
  metricas: T_METRICAS,
};

export async function getClientes() {
  const records = await airtableList(T_CLIENTES);
  return records.map((r) => ({ id: r.id, ...r.fields }));
}

// -------------------------------------------------------------------- Asana

function asanaHeaders() {
  return { Authorization: `Bearer ${process.env.ASANA_TOKEN}` };
}

export async function asanaProjects() {
  let ws = asanaProjects._ws;
  if (!ws) {
    const body = await api("https://app.asana.com/api/1.0/workspaces", asanaHeaders());
    ws = body.data[0].gid;
    asanaProjects._ws = ws;
  }
  const body = await api(
    `https://app.asana.com/api/1.0/projects?workspace=${ws}&limit=100&opt_fields=name`,
    asanaHeaders()
  );
  return body.data;
}

export async function asanaOpenTasks(projectGid) {
  const tasks = [];
  let offset;
  do {
    const qs = new URLSearchParams({
      project: projectGid,
      completed_since: "now",
      limit: "100",
      opt_fields: "name,due_on,assignee.name,permalink_url",
    });
    if (offset) qs.set("offset", offset);
    const body = await api(`https://app.asana.com/api/1.0/tasks?${qs}`, asanaHeaders());
    tasks.push(...body.data);
    offset = body.next_page?.offset;
  } while (offset);
  return tasks;
}

export function clasificarTareas(tasks, hoyIso) {
  const out = { vencidas: [], hoy: [], semana: [], sinFecha: 0 };
  const hoy = new Date(hoyIso + "T00:00:00Z");
  const fin = new Date(hoy.getTime() + 7 * 86400000);
  for (const t of tasks) {
    if (!t.due_on) { out.sinFecha += 1; continue; }
    const d = new Date(t.due_on + "T00:00:00Z");
    if (d < hoy) out.vencidas.push(t);
    else if (t.due_on === hoyIso) out.hoy.push(t);
    else if (d <= fin) out.semana.push(t);
  }
  out.vencidas.sort((a, b) => a.due_on.localeCompare(b.due_on));
  return out;
}
