# PUNCH! Mission Control — App web (ko.punch.com.mx)

Dashboard confidencial de Punch con login, roles, 2FA y **PUNCHI 🥊**, el asistente
de IA que responde cualquier pregunta de la operación consultando Airtable y Asana
en tiempo real.

## Qué incluye

- **Dashboard**: tarjeta por cliente con semáforo 🔴🟡🟢, vencen hoy, tareas
  vencidas, MRR total y resumen del día (datos de Airtable, sincronizados desde
  Asana por `mission-control/sync.py`).
- **PUNCHI 🥊** (Claude Opus 4.8 con tool use): "¿cómo va GO Outlet?", "¿qué vence
  hoy y de quién?", "¿quién del equipo está saturado?", "¿cuánta cobranza tenemos
  pendiente?" — consulta clientes, tareas de Asana, entregables, equipo y métricas.
- **Usuarios y roles**: `superadmin` (ferdiaz) > `admin` (karensalas, fernandog —
  pueden agregar/desactivar usuarios) > `member` (solo lectura). Altas desde la UI.

## Seguridad

- Contraseñas con **scrypt** + sal por usuario, política de 12+ caracteres,
  cambio forzado en el primer login.
- Sesiones HMAC firmadas, cookie `HttpOnly + Secure + SameSite=Strict`, expiración 12 h.
- **2FA TOTP opcional** por usuario (Google Authenticator / 1Password).
- **Lockout**: 5 intentos fallidos → 15 min bloqueado (por usuario+IP).
- Protección CSRF (header custom + SameSite), headers de seguridad
  (CSP, HSTS, nosniff, no-frame), límite de payload.
- Los tokens de Airtable/Asana/Anthropic viven SOLO en el servidor; el navegador
  nunca los ve. Bitácora de auditoría en `data/audit.log` (logins, altas, chats).
- Contenedor Docker sin root.

## Variables de entorno

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `SESSION_SECRET` | ✅ | 32+ caracteres aleatorios (`openssl rand -base64 48`) |
| `AIRTABLE_TOKEN` | ✅ | PAT de Airtable (scopes `data.records:read` sobre la base) |
| `ASANA_TOKEN` | ✅ | PAT de Asana |
| `ANTHROPIC_API_KEY` | para PUNCHI | API key de Claude (platform.claude.com) |
| `AIRTABLE_BASE_ID` | — | default `appXZ3KMsdvv5tVmg` |
| `PORT` | — | default `8443` |
| `DATA_DIR` | — | carpeta de usuarios/auditoría (persistir en un volumen) |

## Despliegue en ko.punch.com.mx

1. **Servidor** (VPS, Railway, Render o Fly.io):
   ```bash
   docker build -t punch-mc mission-control/app
   docker run -d --name punch-mc -p 127.0.0.1:8443:8443 \
     -v punch-mc-data:/app/data \
     -e SESSION_SECRET=... -e AIRTABLE_TOKEN=... -e ASANA_TOKEN=... \
     -e ANTHROPIC_API_KEY=... punch-mc
   ```
2. **HTTPS**: apunta el subdominio `ko.punch.com.mx` (registro A/CNAME en tu DNS)
   al servidor y pon Caddy enfrente (TLS automático con Let's Encrypt):
   ```
   ko.punch.com.mx {
       reverse_proxy 127.0.0.1:8443
   }
   ```
   (En Railway/Render solo agregas el custom domain y el TLS es automático.)
3. **Usuarios iniciales**:
   ```bash
   docker exec -it punch-mc node scripts/seed-users.js
   ```
   Imprime las contraseñas temporales de ferdiaz (superadmin), karensalas y
   fernandog (admins) una sola vez. Cada quien la cambia al entrar y activa su 2FA.

## Desarrollo local

```bash
cd mission-control/app
npm install
SESSION_SECRET=$(openssl rand -base64 48) AIRTABLE_TOKEN=... ASANA_TOKEN=... \
  ANTHROPIC_API_KEY=... NODE_ENV=development npm start
node scripts/seed-users.js   # primera vez
```

## Preparado para el futuro

- `lib/integrations.js` es el único punto de contacto con datos: agregar Gmail,
  Google Calendar, Facebook Ads o WhatsApp Business API = un módulo más y una
  herramienta nueva en `lib/assistant.js` (PUNCHI las descubre solo).
- El store JSON se cambia por SQLite/Postgres tocando solo `lib/store.js`.
- `data/audit.log` ya registra todo para compliance.
- Webhook de WhatsApp (fase 3): agregar una ruta `/api/webhooks/whatsapp` que
  actualice `Última Conversación` en Airtable.
