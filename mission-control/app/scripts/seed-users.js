// Crea los usuarios iniciales del Mission Control con contraseñas temporales.
// Correr UNA vez: SESSION_SECRET=... node scripts/seed-users.js
// Imprime las contraseñas temporales una sola vez — compártelas en persona;
// cada quien debe cambiarla al primer login.
import crypto from "node:crypto";
import { hashPassword } from "../lib/auth.js";
import { readJson, writeJson } from "../lib/store.js";

const SEED = [
  { email: "ferdiaz@punch.com.mx", name: "Fernando Díaz", role: "superadmin" },
  { email: "karensalas@punch.com.mx", name: "Karen Salas", role: "admin" },
  { email: "fernandog@punch.com.mx", name: "Fernando García", role: "admin" },
];

const users = readJson("users.json", []);
for (const s of SEED) {
  if (users.some((u) => u.email === s.email)) {
    console.log(`- ${s.email}: ya existe, sin cambios`);
    continue;
  }
  const temp = crypto.randomBytes(9).toString("base64url") + "aA1";
  users.push({
    ...s,
    passwordHash: hashPassword(temp),
    mustChangePassword: true,
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: "seed",
  });
  console.log(`+ ${s.email} (${s.role}) — contraseña temporal: ${temp}`);
}
writeJson("users.json", users);
console.log("\nListo. Estas contraseñas no se vuelven a mostrar.");
