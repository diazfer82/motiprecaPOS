# Desplegar el Mission Control con EasyPanel (VPS Hostinger)

EasyPanel construye la imagen desde el repo de GitHub, le pone HTTPS automático
(aunque sea con su subdominio `*.easypanel.host`) y maneja reinicios y deploys.

## 1. Crear el servicio

1. En EasyPanel → **+ Create Project** → nombre: `punch`
2. Dentro del proyecto → **+ Service** → **App**  → nombre: `mission-control`

## 2. Source (pestaña "Source" / "General")

- **Source type:** GitHub (conecta tu cuenta si el repo es privado) o Git
- **Repository:** `diazfer82/motiprecaPOS`
- **Branch:** `claude/gracious-einstein-bazr2y`
- **Build path:** `/mission-control/app`

## 3. Build

- **Build type:** `Dockerfile`
- **Dockerfile path:** `Dockerfile` (relativo al build path)

## 4. Environment (pestaña "Environment")

```
NODE_ENV=production
PORT=80
DATA_DIR=/app/data
SESSION_SECRET=<openssl rand -base64 48>
AIRTABLE_TOKEN=<PAT de Airtable>
ASANA_TOKEN=<PAT de Asana>
ANTHROPIC_API_KEY=<API key de Claude>
```

## 5. Mounts (pestaña "Mounts" / "Advanced")

- **Type:** Volume
- **Name:** `mc-data`
- **Mount path:** `/app/data`

(Sin esto, los usuarios y la auditoría se borran en cada deploy.)

## 6. Domains (pestaña "Domains")

- EasyPanel crea solo un dominio tipo `mission-control-punch.xxxx.easypanel.host`
  con **HTTPS automático** → con ese ya puedes entrar seguro.
- **Port:** `80` (el puerto interno de la app)
- Cuando recuperes el DNS: **Add domain** → `ko.punch.com.mx` (con el registro A
  apuntando al VPS) y EasyPanel emite el certificado solo.

## 7. Deploy

Botón **Deploy**. Espera a que el build termine (1-2 min).

## 8. Crear los 3 usuarios iniciales (una sola vez)

Pestaña **Console** del servicio (o Terminal del contenedor):

```bash
node scripts/seed-users.js
```

Imprime las contraseñas temporales de ferdiaz (superadmin), karensalas y
fernandog (admins) **una sola vez** — guárdalas. Cada quien la cambia al
entrar y activa su 2FA.

## Notas

- **Auto-deploy:** activa "Deploy on push" en EasyPanel para que cada push a la
  rama actualice la app solo.
- El healthcheck interno responde en `/login`.
- El briefing diario por correo (sync.py) sigue corriendo por GitHub Actions;
  no depende de este servicio.
