// PUNCHI 🥊 — el asistente de IA del Mission Control.
// Loop agéntico manual sobre el Claude API (streaming + tool use): PUNCHI decide
// qué consultar de Airtable/Asana, ejecutamos la herramienta del lado del
// servidor y le devolvemos el resultado hasta que tiene la respuesta completa.
import Anthropic from "@anthropic-ai/sdk";
import {
  getClientes,
  airtableList,
  tables,
  asanaProjects,
  asanaOpenTasks,
  clasificarTareas,
} from "./integrations.js";

const MODEL = "claude-opus-4-8";
const MAX_ITERATIONS = 8;

const SYSTEM_PROMPT = `Eres PUNCHI 🥊, el asistente interno de PUNCH! Marketing (agencia en Cancún, México).
Tu trabajo es responder cualquier pregunta del equipo sobre la operación de Punch: clientes, entregables, tareas de Asana, equipo, facturación y métricas.

Personalidad: coqueto, ágil y directo — como buen sparring. Una pizca de humor de box ("vamos al siguiente round", "ese cliente necesita un jab"), pero nunca a costa de la claridad. Respondes SIEMPRE en español mexicano.

Reglas:
- Usa las herramientas para responder con datos reales; nunca inventes cifras, nombres ni fechas.
- Si la pregunta es sobre "cómo va" un cliente, combina su ficha de Airtable (semáforo, riesgo, ticket, notas) con sus tareas de Asana (vencidas/hoy).
- Cifras de dinero en pesos mexicanos con formato $50,000.
- Sé conciso: primero la respuesta, después el detalle. Usa listas cuando ayuden.
- Si no encuentras algo, dilo claro y sugiere dónde podría estar.
- Información confidencial: todo lo que ves es interno de Punch; nunca sugieras compartirlo fuera.`;

const TOOLS = [
  {
    name: "listar_clientes",
    description:
      "Lista todos los clientes de Punch desde Airtable con su semáforo, status, riesgo, ticket mensual, account manager, tareas vencidas, resumen del día y última conversación de WhatsApp. Úsala para panoramas generales o para ubicar a un cliente por nombre.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "tareas_asana_proyecto",
    description:
      "Trae las tareas INCOMPLETAS de un proyecto de Asana (nombre, fecha de vencimiento, responsable, link) y las clasifica en vencidas / vencen hoy / próximos 7 días. Usa el campo 'Asana GID' que viene en listar_clientes. Llámala cuando pregunten qué está pendiente, atrasado o quién tiene qué.",
    input_schema: {
      type: "object",
      properties: {
        project_gid: { type: "string", description: "GID del proyecto de Asana (campo 'Asana GID' del cliente)" },
      },
      required: ["project_gid"],
      additionalProperties: false,
    },
  },
  {
    name: "listar_proyectos_asana",
    description:
      "Lista todos los proyectos del workspace de Asana con nombre y GID. Úsala solo si un cliente no tiene 'Asana GID' en Airtable y necesitas encontrar su proyecto por nombre.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "entregables",
    description:
      "Lista los entregables comprometidos (tabla Entregables de Airtable): cliente, departamento, responsable, fecha compromiso, estado y prioridad.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "equipo",
    description:
      "Lista el equipo de Punch (tabla Equipo de Airtable): nombre, rol, departamento, email, capacidad de esta semana y clientes asignados. Úsala para preguntas de carga de trabajo o de quién lleva qué cliente.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "metricas_semanales",
    description:
      "Métricas semanales del negocio (Airtable): facturación, cobranza recibida y pendiente, clientes nuevos/perdidos y NPS promedio por semana. Úsala para preguntas de dinero o tendencia del negocio.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function hoyIso() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Cancun" });
}

async function runTool(name, input) {
  switch (name) {
    case "listar_clientes":
      return getClientes();
    case "tareas_asana_proyecto": {
      const tasks = await asanaOpenTasks(input.project_gid);
      const c = clasificarTareas(tasks, hoyIso());
      return {
        total_abiertas: tasks.length,
        vencidas: c.vencidas.slice(0, 40),
        vencen_hoy: c.hoy,
        proximos_7_dias: c.semana,
        sin_fecha: c.sinFecha,
      };
    }
    case "listar_proyectos_asana":
      return asanaProjects();
    case "entregables":
      return (await airtableList(tables.entregables)).map((r) => r.fields);
    case "equipo":
      return (await airtableList(tables.equipo)).map((r) => r.fields);
    case "metricas_semanales":
      return (await airtableList(tables.metricas)).map((r) => r.fields);
    default:
      throw new Error(`Herramienta desconocida: ${name}`);
  }
}

/**
 * Corre una conversación con PUNCHI.
 * @param {Array} history - mensajes previos [{role, content}] (formato del API)
 * @param {string} userMessage - mensaje nuevo del usuario
 * @param {(event: object) => void} emit - callback SSE: {type:"text",text}|{type:"tool",name}|{type:"done",messages}
 */
export async function chatWithPunchi(history, userMessage, emit) {
  const client = new Anthropic(); // ANTHROPIC_API_KEY del entorno
  const messages = [
    ...history,
    {
      role: "user",
      content: `[Hoy es ${hoyIso()}, hora de Cancún]\n${userMessage}`,
    },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
    });

    stream.on("text", (delta) => emit({ type: "text", text: delta }));
    const response = await stream.finalMessage();

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      emit({ type: "done", messages });
      return;
    }

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      emit({ type: "tool", name: block.name });
      try {
        const result = await runTool(block.name, block.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result).slice(0, 120_000),
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Error al consultar: ${err.message}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  emit({ type: "text", text: "\n\n(Llegué al límite de consultas de este round — pregúntame de nuevo y seguimos.)" });
  emit({ type: "done", messages });
}
