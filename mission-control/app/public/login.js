const f = document.getElementById("f");
const err = document.getElementById("err");
f.addEventListener("submit", async (e) => {
  e.preventDefault();
  err.textContent = "";
  const body = {
    email: document.getElementById("email").value.trim(),
    password: document.getElementById("password").value,
    totp: document.getElementById("totp").value.trim() || undefined,
  };
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-MC-CSRF": "1" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) { location.href = "/"; return; }
  if (data.error === "totp_required") {
    document.getElementById("totpRow").style.display = "block";
    err.textContent = "Ingresa tu código 2FA.";
    return;
  }
  err.textContent = data.error || "Error de acceso.";
});
