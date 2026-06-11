// Autenticación y autorización del Mission Control.
//  - Contraseñas: scrypt (crypto nativo), sal por usuario, comparación constante.
//  - Sesiones: token aleatorio firmado HMAC, cookie HttpOnly+Secure+SameSite.
//  - Lockout: 5 intentos fallidos => 15 minutos de bloqueo por usuario+IP.
//  - 2FA TOTP opcional (Google Authenticator / 1Password).
//  - Roles: superadmin > admin > member.
import crypto from "node:crypto";
import { readJson, writeJson, appendAudit } from "./store.js";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas
const LOCKOUT_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

const SECRET = process.env.SESSION_SECRET;
if (!SECRET || SECRET.length < 32) {
  throw new Error("SESSION_SECRET debe existir y tener al menos 32 caracteres");
}

// ---------------------------------------------------------------- passwords

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  try {
    const [, saltHex, hashHex] = stored.split(":");
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64, {
      N: 16384, r: 8, p: 1,
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function validatePasswordPolicy(password) {
  if (typeof password !== "string" || password.length < 12) {
    return "La contraseña debe tener mínimo 12 caracteres.";
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Debe incluir mayúsculas, minúsculas y números.";
  }
  return null;
}

// -------------------------------------------------------------------- users

export function getUsers() {
  return readJson("users.json", []);
}

export function saveUsers(users) {
  writeJson("users.json", users);
}

export function findUser(email) {
  return getUsers().find((u) => u.email.toLowerCase() === String(email).toLowerCase());
}

const ROLE_RANK = { member: 0, admin: 1, superadmin: 2 };

export function canManage(actor, targetRole) {
  // superadmin gestiona a todos; admin solo crea/gestiona members y admins
  // (pero no puede tocar al superadmin ni autopromoverse).
  if (actor.role === "superadmin") return true;
  if (actor.role === "admin") return ROLE_RANK[targetRole] <= ROLE_RANK.admin && targetRole !== "superadmin";
  return false;
}

// ----------------------------------------------------------------- sessions

const sessions = new Map(); // token -> { email, expires }

function sign(value) {
  return crypto.createHmac("sha256", SECRET).update(value).digest("base64url");
}

export function createSession(email) {
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(token, { email, expires: Date.now() + SESSION_TTL_MS });
  return `${token}.${sign(token)}`;
}

export function getSession(cookieValue) {
  if (!cookieValue) return null;
  const [token, sig] = String(cookieValue).split(".");
  if (!token || !sig) return null;
  const expected = sign(token);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) { sessions.delete(token); return null; }
  const user = findUser(s.email);
  return user ? { token, user } : null;
}

export function destroySession(cookieValue) {
  const token = String(cookieValue || "").split(".")[0];
  sessions.delete(token);
}

// ------------------------------------------------------------------ lockout

const attempts = new Map(); // key -> { count, first }

export function isLockedOut(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > LOCKOUT_WINDOW_MS) { attempts.delete(key); return false; }
  return a.count >= LOCKOUT_ATTEMPTS;
}

export function recordFailure(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > LOCKOUT_WINDOW_MS) {
    attempts.set(key, { count: 1, first: Date.now() });
  } else {
    a.count += 1;
  }
}

export function clearFailures(key) {
  attempts.delete(key);
}

// --------------------------------------------------------------------- TOTP

function base32Decode(str) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const ch of str.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

export function generateTotpSecret() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  return Array.from(crypto.randomBytes(20), (b) => alphabet[b % 32]).join("");
}

export function totpCode(secret, timeStep = Math.floor(Date.now() / 30000)) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(timeStep));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000);
  return String(code).padStart(6, "0");
}

export function verifyTotp(secret, code) {
  const step = Math.floor(Date.now() / 30000);
  // tolera ±1 ventana (deriva de reloj)
  return [step - 1, step, step + 1].some((s) => {
    const expected = totpCode(secret, s);
    return expected.length === String(code).length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(code)));
  });
}

export { appendAudit };
