#!/usr/bin/env bash
# Instalación endurecida del Mission Control en un VPS Ubuntu/Debian (Hostinger).
# Correr como root UNA vez:  bash setup-vps.sh
# Es idempotente: se puede volver a correr sin romper nada.
set -euo pipefail

echo "==> [1/6] Actualizando sistema y parches automáticos de seguridad"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq unattended-upgrades fail2ban ufw curl git
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> [2/6] Firewall: solo SSH, HTTP y HTTPS"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> [3/6] fail2ban protegiendo SSH"
systemctl enable --now fail2ban

echo "==> [4/6] Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> [5/6] Endureciendo SSH (sin login root por contraseña)"
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/99-punch-hardening.conf <<'EOF'
PermitRootLogin prohibit-password
PasswordAuthentication no
MaxAuthTries 3
EOF
echo "    OJO: esto desactiva el login por contraseña. Asegúrate de tener tu"
echo "    llave SSH cargada ANTES de reiniciar sshd (ssh-copy-id)."
echo "    Cuando estés seguro corre: systemctl restart ssh"

echo "==> [6/6] Backup diario del volumen de datos (usuarios, auditoría)"
mkdir -p /opt/punch-backups
cat > /etc/cron.daily/punch-mc-backup <<'EOF'
#!/bin/sh
docker run --rm -v deploy_app-data:/data -v /opt/punch-backups:/backup alpine \
  tar czf "/backup/mc-data-$(date +%Y%m%d).tar.gz" -C /data .
find /opt/punch-backups -name 'mc-data-*.tar.gz' -mtime +30 -delete
EOF
chmod +x /etc/cron.daily/punch-mc-backup

echo ""
echo "✅ VPS listo. Siguientes pasos (ver DEPLOY.md):"
echo "   1. git clone del repo en /opt/punch-mc"
echo "   2. cd /opt/punch-mc/mission-control/deploy && cp .env.example .env && nano .env"
echo "   3. docker compose up -d --build"
echo "   4. docker compose exec app node scripts/seed-users.js"
