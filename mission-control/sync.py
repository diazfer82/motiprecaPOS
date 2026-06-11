#!/usr/bin/env python3
"""PUNCH! Marketing — Mission Control.

Sincroniza Asana -> Airtable y envía el briefing diario por correo.

Para cada cliente en la tabla `Clientes` de Airtable que tenga `Asana GID`:
  1. Lee las tareas incompletas del proyecto en Asana.
  2. Calcula: tareas vencidas, vencen hoy, vencen esta semana, abiertas.
  3. Calcula el semáforo (🔴/🟡/🟢) combinando backlog, riesgo y status.
  4. Escribe los resultados de vuelta en Airtable.
  5. Arma un briefing HTML por cliente y lo envía por SMTP.

Variables de entorno requeridas (ver README):
  ASANA_TOKEN, AIRTABLE_TOKEN
Opcionales para el correo:
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_TO, EMAIL_FROM
Sin configuración SMTP el script solo sincroniza y deja el briefing en
mission-control/briefing.html (artefacto del workflow).
"""

import json
import os
import smtplib
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from zoneinfo import ZoneInfo

AIRTABLE_BASE_ID = os.environ.get("AIRTABLE_BASE_ID", "appXZ3KMsdvv5tVmg")
CLIENTES_TABLE_ID = os.environ.get("AIRTABLE_CLIENTES_TABLE", "tblreG0OGeYKvFxLh")
TZ = ZoneInfo(os.environ.get("MC_TIMEZONE", "America/Cancun"))

# IDs de campos de la tabla Clientes (estables aunque se renombren).
F_CLIENTE = "fldTyDtqODzFAqBYm"
F_STATUS = "fld9EVgWYhwoU98iM"
F_RIESGO = "fld1swAijLZQb52Nh"
F_TICKET = "fldhfNjb0vOKPpUBo"
F_ULTIMA_CONV = "fldcr1PLfakJNmQm2"
F_NOTAS = "fldmjJSPOStrZeq6q"
F_ASANA_GID = "fldFU3Hdc39bXHrMx"
F_ASANA_LINK = "fldx2nJ4VDJdmkYWG"
F_VENCIDAS = "fldAlJAISPcqZoGmP"
F_HOY = "fldrQ7bDIfoRJC63L"
F_SEMANA = "fldfvmBisAcDIoSwa"
F_ABIERTAS = "fldfvtIdqqp8wwicd"
F_SEMAFORO = "fldagJLsjg2pNzkJL"
F_RESUMEN = "fld4qZE0XV1aUjXoT"
F_SYNC = "fldZoQS26V6PMDolT"

DIAS_SIN_CONTACTO_ALERTA = 5


def http_json(url, headers, method="GET", payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    if payload is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


# ---------------------------------------------------------------- Airtable

def airtable_headers():
    return {"Authorization": f"Bearer {os.environ['AIRTABLE_TOKEN']}"}


def airtable_list_clientes():
    records, offset = [], None
    base = (
        f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{CLIENTES_TABLE_ID}"
        "?returnFieldsByFieldId=true&pageSize=100"
    )
    while True:
        url = base + (f"&offset={offset}" if offset else "")
        body = http_json(url, airtable_headers())
        records.extend(body.get("records", []))
        offset = body.get("offset")
        if not offset:
            return records


def airtable_update(records):
    url = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{CLIENTES_TABLE_ID}"
    for i in range(0, len(records), 10):  # límite de 10 por PATCH
        http_json(url, airtable_headers(), "PATCH", {"records": records[i : i + 10]})


# ------------------------------------------------------------------- Asana

def asana_open_tasks(project_gid):
    """Tareas incompletas del proyecto, con nombre, fecha y responsable."""
    tasks, offset = [], None
    base = (
        f"https://app.asana.com/api/1.0/tasks?project={project_gid}"
        "&completed_since=now&limit=100"
        "&opt_fields=name,due_on,assignee.name"
    )
    headers = {"Authorization": f"Bearer {os.environ['ASANA_TOKEN']}"}
    while True:
        url = base + (f"&offset={offset}" if offset else "")
        body = http_json(url, headers)
        tasks.extend(body.get("data", []))
        offset = (body.get("next_page") or {}).get("offset")
        if not offset:
            return tasks


# ------------------------------------------------------------------ Lógica

def clasificar(tasks, hoy):
    fin_semana = hoy + timedelta(days=7)
    vencidas, vencen_hoy, semana = [], [], []
    for t in tasks:
        if not t.get("due_on"):
            continue
        d = date.fromisoformat(t["due_on"])
        if d < hoy:
            vencidas.append(t)
        elif d == hoy:
            vencen_hoy.append(t)
        elif d <= fin_semana:
            semana.append(t)
    vencidas.sort(key=lambda t: t["due_on"])
    return vencidas, vencen_hoy, semana


def semaforo(n_vencidas, riesgo, status):
    if n_vencidas >= 5 or riesgo == "Alto" or status == "Rojo":
        return "🔴 Crítico"
    if n_vencidas >= 1 or riesgo == "Medio" or status == "Atención":
        return "🟡 Atención"
    return "🟢 Sano"


def nombre(t):
    a = t.get("assignee") or {}
    quien = a.get("name") or "sin asignar"
    return f"{t['name']} ({quien}, {t['due_on']})"


def resumen_dia(vencidas, vencen_hoy, semana, abiertas, status, riesgo, dias_sin_contacto):
    partes = []
    if vencen_hoy:
        partes.append("Vencen HOY: " + "; ".join(nombre(t) for t in vencen_hoy[:5]) + ".")
    if vencidas:
        partes.append(
            f"{len(vencidas)} vencidas de {abiertas} abiertas"
            f" (la más antigua: {vencidas[0]['due_on']})."
        )
        recientes = [t for t in vencidas[-3:]]
        partes.append("Últimas vencidas: " + "; ".join(nombre(t) for t in recientes) + ".")
    if semana:
        partes.append(f"{len(semana)} entregables en los próximos 7 días.")
    if status == "Rojo" or riesgo == "Alto":
        partes.append("⚠️ Cliente en riesgo: requiere contacto del AM hoy.")
    if dias_sin_contacto is not None and dias_sin_contacto >= DIAS_SIN_CONTACTO_ALERTA:
        partes.append(f"🔇 {dias_sin_contacto} días sin conversación registrada (WhatsApp).")
    if not partes:
        partes.append("Sin pendientes con fecha. Todo en orden.")
    return " ".join(partes)


# ---------------------------------------------------------------- Briefing

def briefing_html(filas, hoy):
    orden = {"🔴 Crítico": 0, "🟡 Atención": 1, "🟢 Sano": 2, "": 3}
    filas = sorted(filas, key=lambda f: (orden.get(f["semaforo"], 3), -f["vencidas"]))
    cuerpo = [
        f"<h2>PUNCH! Mission Control — {hoy.strftime('%d %b %Y')}</h2>",
        "<p>Resumen diario por cliente, ordenado por urgencia.</p>",
        "<table border='1' cellpadding='6' cellspacing='0' "
        "style='border-collapse:collapse;font-family:sans-serif;font-size:13px'>",
        "<tr style='background:#222;color:#fff'>"
        "<th>Cliente</th><th>Semáforo</th><th>Hoy</th><th>Vencidas</th>"
        "<th>7 días</th><th>Lo más importante</th></tr>",
    ]
    for f in filas:
        link = f"<a href='{f['link']}'>{f['cliente']}</a>" if f["link"] else f["cliente"]
        cuerpo.append(
            f"<tr><td><b>{link}</b></td><td>{f['semaforo']}</td>"
            f"<td align='center'>{f['hoy']}</td><td align='center'>{f['vencidas']}</td>"
            f"<td align='center'>{f['semana']}</td><td>{f['resumen']}</td></tr>"
        )
    cuerpo.append("</table>")
    cuerpo.append(
        "<p style='color:#888;font-size:11px'>Generado automáticamente por "
        "Mission Control (Asana → Airtable → correo).</p>"
    )
    return "\n".join(cuerpo)


def enviar_correo(html, hoy):
    host = os.environ.get("SMTP_HOST")
    to = os.environ.get("EMAIL_TO")
    if not host or not to:
        print("SMTP no configurado: se omite el envío de correo.")
        return False
    user = os.environ.get("SMTP_USER", "")
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"🚀 PUNCH! Briefing diario — {hoy.strftime('%d/%m/%Y')}"
    msg["From"] = os.environ.get("EMAIL_FROM", user)
    msg["To"] = to
    msg.attach(MIMEText(html, "html", "utf-8"))
    port = int(os.environ.get("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=60) as s:
        s.starttls()
        if user:
            s.login(user, os.environ["SMTP_PASS"])
        s.sendmail(msg["From"], [d.strip() for d in to.split(",")], msg.as_string())
    print(f"Briefing enviado a {to}.")
    return True


# -------------------------------------------------------------------- Main

def main():
    ahora = datetime.now(timezone.utc)
    hoy = ahora.astimezone(TZ).date()
    clientes = airtable_list_clientes()
    updates, filas = [], []

    for rec in clientes:
        f = rec.get("fields", {})
        cliente = f.get(F_CLIENTE, "(sin nombre)")
        gid = (f.get(F_ASANA_GID) or "").strip()
        if not gid:
            print(f"- {cliente}: sin Asana GID, se omite.")
            continue

        tasks = asana_open_tasks(gid)
        vencidas, vencen_hoy, semana = clasificar(tasks, hoy)
        status = (f.get(F_STATUS) or {}).get("name") if isinstance(f.get(F_STATUS), dict) else f.get(F_STATUS)
        riesgo = (f.get(F_RIESGO) or {}).get("name") if isinstance(f.get(F_RIESGO), dict) else f.get(F_RIESGO)

        dias_sin_contacto = None
        if f.get(F_ULTIMA_CONV):
            dias_sin_contacto = (hoy - date.fromisoformat(f[F_ULTIMA_CONV])).days

        sem = semaforo(len(vencidas), riesgo, status)
        resumen = resumen_dia(
            vencidas, vencen_hoy, semana, len(tasks), status, riesgo, dias_sin_contacto
        )
        updates.append(
            {
                "id": rec["id"],
                "fields": {
                    F_VENCIDAS: len(vencidas),
                    F_HOY: len(vencen_hoy),
                    F_SEMANA: len(semana),
                    F_ABIERTAS: len(tasks),
                    F_SEMAFORO: sem,
                    F_RESUMEN: resumen,
                    F_SYNC: ahora.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                },
            }
        )
        filas.append(
            {
                "cliente": cliente,
                "link": f.get(F_ASANA_LINK, ""),
                "semaforo": sem,
                "hoy": len(vencen_hoy),
                "vencidas": len(vencidas),
                "semana": len(semana),
                "resumen": resumen,
            }
        )
        print(f"- {cliente}: {sem} | hoy={len(vencen_hoy)} vencidas={len(vencidas)}")

    if updates:
        airtable_update(updates)
        print(f"Airtable actualizado ({len(updates)} clientes).")

    html = briefing_html(filas, hoy)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "briefing.html")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"Briefing guardado en {out}.")
    enviar_correo(html, hoy)


if __name__ == "__main__":
    try:
        main()
    except KeyError as e:
        sys.exit(f"Falta la variable de entorno {e}. Ver mission-control/README.md")
