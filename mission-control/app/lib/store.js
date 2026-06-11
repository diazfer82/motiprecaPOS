// Almacenamiento JSON con escritura atómica. Para 3-20 usuarios es más que
// suficiente; si Punch crece, migrar a SQLite/Postgres sin cambiar la interfaz.
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.join(import.meta.dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

export function readJson(name, fallback) {
  const file = path.join(DATA_DIR, name);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(name, data) {
  const file = path.join(DATA_DIR, name);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function appendAudit(entry) {
  const file = path.join(DATA_DIR, "audit.log");
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
  fs.appendFileSync(file, line, { mode: 0o600 });
}
