# PUNCH! Mission Control

Centro de mando para ver en un vistazo en qué va cada cliente, con sincronización
diaria Asana → Airtable y briefing por correo cada mañana.

## Cómo funciona

```
Asana (tareas por cliente)
        │  sync.py (diario 7:30 am, GitHub Actions)
        ▼
Airtable "Punch! Clientes y más" → tabla Clientes
  Semáforo 🔴🟡🟢 · Tareas Vencidas · Vencen Hoy · Vencen Esta Semana
  Tareas Abiertas · Resumen del Día · Última Sync
        │
        ▼
Briefing HTML por correo (lo más importante por cliente, ordenado por urgencia)
```

El mapeo cliente ↔ proyecto vive en el campo **Asana GID** de la tabla
`Clientes`. Para dar de alta un cliente nuevo en el mission control basta con
pegarle el GID de su proyecto de Asana (el número que aparece en la URL del
proyecto).

## Reglas del semáforo

- 🔴 **Crítico**: 5+ tareas vencidas, riesgo "Alto" o status "Rojo".
- 🟡 **Atención**: 1+ vencidas, riesgo "Medio" o status "Atención".
- 🟢 **Sano**: sin vencidas y sin alertas.

Además, si `Última Conversación` (WhatsApp, capturada por el AM) tiene 5+ días,
el resumen del día lo marca con 🔇.

## Configuración (una sola vez)

En GitHub → Settings → Secrets and variables → Actions, crear:

| Secret | Valor |
| --- | --- |
| `ASANA_TOKEN` | Personal Access Token de Asana (app.asana.com → Settings → Apps → Developer apps) |
| `AIRTABLE_TOKEN` | Personal Access Token de Airtable con scopes `data.records:read/write` sobre la base `Punch! Clientes y más` |
| `SMTP_HOST` | p. ej. `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | cuenta que envía (p. ej. `ferdiaz@punch.com.mx`) |
| `SMTP_PASS` | App Password de Google (myaccount.google.com → Seguridad → Contraseñas de aplicaciones) |
| `EMAIL_TO` | destinatarios separados por coma |
| `EMAIL_FROM` | remitente (opcional, default `SMTP_USER`) |

Sin los secrets de SMTP el workflow igual sincroniza Airtable y deja el
briefing como artefacto descargable del run.

## Ejecutar a mano

```bash
ASANA_TOKEN=... AIRTABLE_TOKEN=... python mission-control/sync.py
```

O desde GitHub: Actions → "Mission Control diario" → Run workflow.

## Pendientes conocidos

- **GO Outlet Panoramicos** comparte el proyecto `00 GO OUTLET` de Asana con
  GO Outlet Integral; para separar métricas hay que dividir el proyecto o
  etiquetar las tareas.
- El backlog de Asana arrastra tareas vencidas desde 2024 que nunca se
  cerraron; mientras no se depure, casi todos los clientes saldrán en 🔴.
- Integración WhatsApp (fase 3): hoy `Última Conversación` se captura a mano;
  con WhatsApp Business API se puede automatizar.
