// PUNCH! Mission Control — servidor web seguro.
// Node 20+, sin framework: http nativo + módulos propios.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  findUser, getUsers, saveUsers, hashPassword, verifyPassword,
  validatePasswordPolicy, createSession, getSession, destroySession,
  isLockedOut, recordFailure, clearFailures, canManage,
  generateTotpSecret, verifyTotp, appendAudit,
} from "./lib/auth.js";
import { getClientes } from "./lib/integrations.js";
import { chatWithPunchi } from "./lib/assistant.js";

const PORT = Number(process.env.PORT || 8443);
const PUBLIC_DIR = path.join(import.meta.dirname, "public");
const IS_PROD = process.env.NODE_ENV !== "development";

// ------------------------------------------------------------------ helpers

function send(res, status, body, headers = {}) {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
    ...headers,
  });
  res.end(data);
}

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
  );
  if (IS_PROD) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "").split(";").map((c) => {
      const i = c.indexOf("=");
      return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
    }).filter(([k]) => k)
  );
}

function sessionCookie(value, maxAgeSec) {
  const flags = [`mc_session=${encodeURIComponent(value)}`, "HttpOnly", "Path=/", "SameSite=Strict"];
  if (IS_PROD) flags.push("Secure");
  if (maxAgeSec !== undefined) flags.push(`Max-Age=${maxAgeSec}`);
  return flags.join("; ");
}

async function readBody(req, limit = 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("payload demasiado grande");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { return {}; }
}

function clientIp(req) {
  // Detrás del reverse proxy (Caddy/nginx) confiamos en X-Forwarded-For.
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress || "unknown";
}

function publicUser(u) {
  return {
    email: u.email, name: u.name, role: u.role,
    totpEnabled: Boolean(u.totpSecret), mustChangePassword: Boolean(u.mustChangePassword),
  };
}

// ------------------------------------------------------------------- router

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url, "http://localhost");
  const cookies = parseCookies(req);
  const session = getSession(cookies.mc_session);

  // CSRF: las mutaciones requieren el header custom (los navegadores no lo
  // mandan cross-site) además de la cookie SameSite=Strict.
  if (req.method !== "GET" && url.pathname.startsWith("/api/") &&
      req.headers["x-mc-csrf"] !== "1") {
    return send(res, 403, { error: "CSRF check failed" });
  }

  try {
    // ------------------------------------------------------------- públicos
    if (url.pathname === "/api/login" && req.method === "POST") {
      const { email, password, totp } = await readBody(req);
      const key = `${String(email).toLowerCase()}|${clientIp(req)}`;
      if (isLockedOut(key)) {
        appendAudit({ event: "login_lockout", email, ip: clientIp(req) });
        return send(res, 429, { error: "Demasiados intentos. Espera 15 minutos." });
      }
      const user = findUser(email);
      if (!user || !user.active || !verifyPassword(String(password || ""), user.passwordHash)) {
        recordFailure(key);
        appendAudit({ event: "login_fail", email, ip: clientIp(req) });
        return send(res, 401, { error: "Credenciales incorrectas." });
      }
      if (user.totpSecret) {
        if (!totp) return send(res, 401, { error: "totp_required" });
        if (!verifyTotp(user.totpSecret, String(totp))) {
          recordFailure(key);
          return send(res, 401, { error: "Código 2FA incorrecto." });
        }
      }
      clearFailures(key);
      appendAudit({ event: "login_ok", email: user.email, ip: clientIp(req) });
      res.setHeader("Set-Cookie", sessionCookie(createSession(user.email)));
      return send(res, 200, { user: publicUser(user) });
    }

    if (url.pathname === "/login" || url.pathname === "/login.html") {
      return send(res, 200, fs.readFileSync(path.join(PUBLIC_DIR, "login.html"), "utf8"));
    }

    // --------------------------------------------------- requieren sesión
    if (!session) {
      if (url.pathname.startsWith("/api/")) return send(res, 401, { error: "No autenticado" });
      res.writeHead(302, { Location: "/login" });
      return res.end();
    }
    const me = session.user;

    if (url.pathname === "/api/logout" && req.method === "POST") {
      destroySession(cookies.mc_session);
      res.setHeader("Set-Cookie", sessionCookie("", 0));
      return send(res, 200, { ok: true });
    }

    if (url.pathname === "/api/me") return send(res, 200, { user: publicUser(me) });

    if (url.pathname === "/api/change-password" && req.method === "POST") {
      const { current, next } = await readBody(req);
      if (!verifyPassword(String(current || ""), me.passwordHash)) {
        return send(res, 401, { error: "Contraseña actual incorrecta." });
      }
      const policy = validatePasswordPolicy(next);
      if (policy) return send(res, 400, { error: policy });
      const users = getUsers();
      const u = users.find((x) => x.email === me.email);
      u.passwordHash = hashPassword(next);
      u.mustChangePassword = false;
      saveUsers(users);
      appendAudit({ event: "password_change", email: me.email });
      return send(res, 200, { ok: true });
    }

    if (url.pathname === "/api/2fa/setup" && req.method === "POST") {
      const secret = generateTotpSecret();
      const users = getUsers();
      const u = users.find((x) => x.email === me.email);
      u.totpPending = secret;
      saveUsers(users);
      const uri = `otpauth://totp/PUNCH%20Mission%20Control:${encodeURIComponent(me.email)}?secret=${secret}&issuer=PUNCH`;
      return send(res, 200, { secret, otpauth: uri });
    }

    if (url.pathname === "/api/2fa/enable" && req.method === "POST") {
      const { code } = await readBody(req);
      const users = getUsers();
      const u = users.find((x) => x.email === me.email);
      if (!u.totpPending || !verifyTotp(u.totpPending, String(code || ""))) {
        return send(res, 400, { error: "Código incorrecto." });
      }
      u.totpSecret = u.totpPending;
      delete u.totpPending;
      saveUsers(users);
      appendAudit({ event: "2fa_enabled", email: me.email });
      return send(res, 200, { ok: true });
    }

    // ------------------------------------------------------------ usuarios
    if (url.pathname === "/api/users" && req.method === "GET") {
      if (me.role === "member") return send(res, 403, { error: "Sin permiso" });
      return send(res, 200, { users: getUsers().map(publicUser) });
    }

    if (url.pathname === "/api/users" && req.method === "POST") {
      const { email, name, role = "member", password } = await readBody(req);
      if (!canManage(me, role)) return send(res, 403, { error: "Sin permiso para crear ese rol" });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) return send(res, 400, { error: "Email inválido" });
      if (findUser(email)) return send(res, 409, { error: "Ese usuario ya existe" });
      const temp = password || crypto.randomBytes(9).toString("base64url") + "aA1";
      const users = getUsers();
      users.push({
        email: String(email).toLowerCase(), name: name || email, role,
        passwordHash: hashPassword(temp), mustChangePassword: true,
        active: true, createdBy: me.email, createdAt: new Date().toISOString(),
      });
      saveUsers(users);
      appendAudit({ event: "user_created", email, role, by: me.email });
      return send(res, 200, { ok: true, tempPassword: temp });
    }

    if (url.pathname === "/api/users" && req.method === "DELETE") {
      const { email } = await readBody(req);
      const target = findUser(email);
      if (!target) return send(res, 404, { error: "No existe" });
      if (target.email === me.email) return send(res, 400, { error: "No puedes desactivarte a ti mismo" });
      if (!canManage(me, target.role)) return send(res, 403, { error: "Sin permiso" });
      const users = getUsers();
      users.find((x) => x.email === target.email).active = false;
      saveUsers(users);
      appendAudit({ event: "user_deactivated", email: target.email, by: me.email });
      return send(res, 200, { ok: true });
    }

    // ----------------------------------------------------------- dashboard
    if (url.pathname === "/api/clientes") {
      const clientes = await getClientes();
      return send(res, 200, { clientes, generatedAt: new Date().toISOString() });
    }

    // ----------------------------------------------------------- PUNCHI 🥊
    if (url.pathname === "/api/chat" && req.method === "POST") {
      if (!process.env.ANTHROPIC_API_KEY) {
        return send(res, 503, { error: "Falta configurar ANTHROPIC_API_KEY para activar a PUNCHI." });
      }
      const { message, history = [] } = await readBody(req, 4 * 1024 * 1024);
      if (!message || typeof message !== "string") return send(res, 400, { error: "Mensaje vacío" });
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const emit = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
      appendAudit({ event: "punchi_chat", email: me.email, chars: message.length });
      try {
        await chatWithPunchi(Array.isArray(history) ? history.slice(-20) : [], message, emit);
      } catch (err) {
        emit({ type: "error", error: err.message });
      }
      return res.end();
    }

    // ------------------------------------------------------------ estático
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return send(res, 200, fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8"));
    }
    // estáticos (solo js/css dentro de public/, sin path traversal)
    const safe = path.normalize(url.pathname).replace(/^([/\\.])+/, "");
    const file = path.join(PUBLIC_DIR, safe);
    if (file.startsWith(PUBLIC_DIR) && /\.(js|css)$/.test(file) && fs.existsSync(file)) {
      res.writeHead(200, {
        "Content-Type": file.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8",
      });
      return res.end(fs.readFileSync(file));
    }
    return send(res, 404, { error: "Not found" });
  } catch (err) {
    appendAudit({ event: "server_error", path: url.pathname, error: err.message });
    return send(res, 500, { error: "Error interno" });
  }
});

server.listen(PORT, () => {
  console.log(`PUNCH! Mission Control escuchando en :${PORT} (${IS_PROD ? "producción" : "desarrollo"})`);
});
