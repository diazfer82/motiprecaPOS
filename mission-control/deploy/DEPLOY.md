# Hostear el Mission Control en ko.punch.com.mx

**Arquitectura:** el VPS de Hostinger corre la app (Docker + Caddy con HTTPS
automático de Let's Encrypt) y el DNS de punch.com.mx (administrado donde está
el dominio, normalmente HostGator) apunta el subdominio `mc` a la IP del VPS.
El hosting compartido de HostGator no se toca — solo su zona DNS.

---

## Paso 1 — DNS (5 min, en HostGator)

1. Entra al cPanel de HostGator → **Zone Editor** (o "Editor de zona DNS")
   del dominio `punch.com.mx`.
   - Si el dominio usa los nameservers del registrador y no los de HostGator,
     este registro se agrega en el panel del registrador.
2. Agrega un registro:
   - **Tipo:** `A`
   - **Nombre:** `mc` (queda `ko.punch.com.mx`)
   - **Valor:** la IP pública de tu VPS de Hostinger (la ves en hPanel → VPS)
   - **TTL:** 300
3. Verifica (puede tardar 5–30 min): `nslookup ko.punch.com.mx` debe regresar
   la IP del VPS. **No sigas al paso 3 hasta que resuelva**, porque Let's
   Encrypt necesita el DNS activo para emitir el certificado.

## Paso 2 — Preparar el VPS (10 min, una sola vez)

Conéctate por SSH al VPS (hPanel te da el comando) y corre:

```bash
curl -fsSL https://raw.githubusercontent.com/diazfer82/motiprecaPOS/claude/gracious-einstein-bazr2y/mission-control/deploy/setup-vps.sh -o setup-vps.sh
bash setup-vps.sh
```

El script deja el VPS endurecido: firewall (solo SSH/80/443), fail2ban,
parches automáticos de seguridad, Docker, SSH sin contraseñas (solo llaves)
y backup diario de los datos con retención de 30 días.

> Si el repo es privado, descarga el script desde GitHub web y pégalo, o usa
> un Personal Access Token: `git clone https://TOKEN@github.com/diazfer82/motiprecaPOS.git`

## Paso 3 — Desplegar la app (10 min)

```bash
# 1. Clonar el repo (con PAT si es privado)
git clone https://github.com/diazfer82/motiprecaPOS.git /opt/punch-mc
cd /opt/punch-mc
git checkout claude/gracious-einstein-bazr2y   # o main cuando se integre

# 2. Configurar secretos
cd mission-control/deploy
cp .env.example .env
echo "SESSION_SECRET=$(openssl rand -base64 48)" # pégalo en .env
nano .env   # llena AIRTABLE_TOKEN, ASANA_TOKEN, ANTHROPIC_API_KEY
chmod 600 .env

# 3. Arrancar
docker compose up -d --build

# 4. Crear los 3 usuarios iniciales (imprime contraseñas temporales UNA vez)
docker compose exec app node scripts/seed-users.js
```

Abre https://ko.punch.com.mx — debe cargar el login con candado verde.

## Paso 4 — Primer acceso (cada usuario)

1. Entrar con la contraseña temporal → el sistema obliga a cambiarla.
2. Botón **"Activar 2FA"** → escanear/agregar la clave en Google Authenticator.
3. Listo: ferdiaz es superadmin; karensalas y fernandog pueden dar de alta
   más usuarios desde el botón **"Usuarios"**.

## Dónde sacar cada llave del `.env`

| Llave | Dónde |
| --- | --- |
| `SESSION_SECRET` | `openssl rand -base64 48` (cualquier valor aleatorio largo) |
| `AIRTABLE_TOKEN` | airtable.com/create/tokens → scopes `data.records:read` y `data.records:write` → acceso a la base "Punch! Clientes y más" |
| `ASANA_TOKEN` | app.asana.com → Settings → Apps → Developer Apps → Create Personal Access Token |
| `ANTHROPIC_API_KEY` | platform.claude.com → API Keys (para PUNCHI; con $5–10 USD/mes de uso normal sobra) |

## Operación diaria

```bash
cd /opt/punch-mc/mission-control/deploy
docker compose logs -f app          # ver logs en vivo
docker compose exec app cat /app/data/audit.log | tail -50   # auditoría
git pull && docker compose up -d --build   # actualizar a la última versión
ls /opt/punch-backups               # backups diarios (30 días de retención)
```

Todo levanta solo si el VPS se reinicia (`restart: unless-stopped`).

## Checklist de robustez (ya incluido)

- [x] HTTPS automático con renovación (Caddy/Let's Encrypt)
- [x] App sin puertos expuestos (solo Caddy ve internet) y contenedor sin root
- [x] Firewall UFW (22/80/443) + fail2ban + parches automáticos del SO
- [x] SSH solo con llave, sin contraseñas
- [x] Reinicio automático de contenedores + healthcheck
- [x] Backup diario de usuarios/auditoría, retención 30 días
- [x] Logs con rotación (no llenan el disco)

## Bonus: el correo diario también puede vivir en el VPS

Si prefieres no usar GitHub Actions para el briefing de las 7:30, en el VPS:

```bash
apt-get install -y python3
crontab -e
# agregar (7:30 am Cancún = 12:30 UTC):
30 12 * * 1-6 cd /opt/punch-mc && ASANA_TOKEN=... AIRTABLE_TOKEN=... SMTP_HOST=smtp.gmail.com SMTP_PORT=587 SMTP_USER=ferdiaz@punch.com.mx SMTP_PASS=... EMAIL_TO=ferdiaz@punch.com.mx python3 mission-control/sync.py >> /var/log/punch-sync.log 2>&1
```
