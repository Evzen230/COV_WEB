#!/usr/bin/env python3
"""Testovací odesílač měření pro domácí ČOV.

Okno s hodnotami, které se opakovaně posílají na POST /api/v1/telemetry.
Používá jen standardní knihovnu Pythonu (tkinter, urllib), nic se neinstaluje.
Spuštění:  python cov_simulator.py
"""
import json
import os
import random
import threading
import tkinter as tk
import uuid
from datetime import datetime, timezone
from tkinter import ttk
from urllib import error, request
from urllib.parse import urlsplit, urlunsplit

DEVICE_ID = "cov-monitor-01"
DEFAULT_SERVER = "http://127.0.0.1:4173"


def server_origin(value):
    """Accept both a server address and a copied browser/API URL."""
    value = value.strip()
    if "://" not in value:
        value = "http://" + value
    parsed = urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Adresa musí mít tvar http://IP_SERVERU:4173")
    # Accessing port also validates malformed port numbers.
    parsed.port
    return urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))

# klíč, popisek, minimum, maximum, šum při "kolísání"
FIELDS = [
    ("temperature", "Teplota (°C)", -55, 125, 0.3),
    ("level", "Hladina (%)", 0, 100, 0.5),
    ("ph", "pH", 0, 14, 0.05),
    ("ec", "Vodivost (µS/cm)", 0, 200000, 5),
    ("turbidity", "Zákal (NTU)", 0, 100000, 0.3),
    ("orp", "ORP (mV)", -2000, 2000, 3),
]

# Přednastavené stavy. Prázdný řetězec = null (nedostupné měření).
PRESETS = {
    "Normální": dict(temperature="18.7", level="64", ph="7.2", ec="842", turbidity="12.4", orp="185"),
    "Vysoká teplota": dict(temperature="35", level="64", ph="7.2", ec="842", turbidity="12.4", orp="185"),
    "Nízká teplota": dict(temperature="1.5", level="64", ph="7.2", ec="842", turbidity="12.4", orp="185"),
    "Vysoká hladina": dict(temperature="18.7", level="97", ph="7.2", ec="842", turbidity="12.4", orp="185"),
    "Chyba čidla (null)": dict(temperature="", level="64", ph="7.2", ec="842", turbidity="12.4", orp="185"),
}


class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("Simulátor měření ČOV")
        root.columnconfigure(0, weight=1)
        root.rowconfigure(1, weight=1)

        self.running = False
        self.counter = 0
        self.boot = uuid.uuid4().hex[:8]
        self.tick_id = None

        top = ttk.Frame(root, padding=10)
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(1, weight=1)

        # Server a interval
        ttk.Label(top, text="Adresa serveru").grid(row=0, column=0, sticky="w", pady=2)
        self.server = tk.StringVar(value=DEFAULT_SERVER)
        ttk.Entry(top, textvariable=self.server).grid(row=0, column=1, columnspan=3, sticky="ew", pady=2)

        ttk.Label(top, text="Interval (s)").grid(row=1, column=0, sticky="w", pady=2)
        self.interval = tk.StringVar(value="5")
        ttk.Spinbox(top, from_=1, to=3600, textvariable=self.interval, width=8).grid(row=1, column=1, sticky="w", pady=2)

        # Hodnoty
        self.vars = {}
        for i, (key, label, *_rest) in enumerate(FIELDS):
            ttk.Label(top, text=label).grid(row=2 + i, column=0, sticky="w", pady=2)
            var = tk.StringVar()
            self.vars[key] = var
            ttk.Entry(top, textvariable=var, width=14).grid(row=2 + i, column=1, sticky="w", pady=2)
        ttk.Label(top, text="Prázdné pole = null (nedostupné měření)", foreground="gray").grid(
            row=2 + len(FIELDS), column=0, columnspan=4, sticky="w")

        r = 3 + len(FIELDS)
        ttk.Label(top, text="Dmychadlo").grid(row=r, column=0, sticky="w", pady=2)
        self.blower = tk.StringVar(value="Neznámé")
        ttk.Combobox(top, textvariable=self.blower, state="readonly", width=12,
                     values=["Neznámé", "Běží", "Neběží"]).grid(row=r, column=1, sticky="w", pady=2)

        self.jitter = tk.BooleanVar(value=True)
        ttk.Checkbutton(top, text="Lehce kolísat hodnoty", variable=self.jitter).grid(
            row=r + 1, column=0, columnspan=2, sticky="w")
        self.paused = tk.BooleanVar(value=False)
        ttk.Checkbutton(top, text="Simulovat výpadek (neposílat nic)", variable=self.paused).grid(
            row=r + 2, column=0, columnspan=2, sticky="w")

        # Přednastavení
        presets = ttk.LabelFrame(top, text="Přednastavené stavy", padding=6)
        presets.grid(row=1, column=2, rowspan=8, columnspan=2, sticky="n", padx=(14, 0))
        for name in PRESETS:
            ttk.Button(presets, text=name, command=lambda n=name: self.apply_preset(n)).pack(fill="x", pady=2)
        ttk.Button(presets, text="Výpadek stanice", command=self.preset_offline).pack(fill="x", pady=2)

        # Ovládání
        buttons = ttk.Frame(top)
        buttons.grid(row=r + 3, column=0, columnspan=4, sticky="ew", pady=(10, 0))
        self.start_btn = ttk.Button(buttons, text="Spustit opakování", command=self.toggle)
        self.start_btn.pack(side="left")
        ttk.Button(buttons, text="Odeslat jednou", command=self.send_once).pack(side="left", padx=8)
        ttk.Button(buttons, text="Ověřit server", command=self.check_server).pack(side="left")

        # Log
        logf = ttk.Frame(root, padding=(10, 0, 10, 10))
        logf.grid(row=1, column=0, sticky="nsew")
        logf.columnconfigure(0, weight=1)
        logf.rowconfigure(0, weight=1)
        self.log = tk.Text(logf, height=10, state="disabled", wrap="word")
        self.log.grid(row=0, column=0, sticky="nsew")
        sb = ttk.Scrollbar(logf, command=self.log.yview)
        sb.grid(row=0, column=1, sticky="ns")
        self.log.configure(yscrollcommand=sb.set)
        self.log.tag_configure("ok", foreground="#1b7f4b")
        self.log.tag_configure("err", foreground="#b3261e")

        for child in top.winfo_children():
            info = child.grid_info()
            if info and int(info["row"]) >= 1:
                child.grid_configure(row=int(info["row"]) + 1)
        ttk.Label(top, text="API klíč stanice").grid(row=1, column=0, sticky="w", pady=2)
        self.api_key = tk.StringVar(value=os.environ.get("COV_API_KEY", ""))
        ttk.Entry(top, textvariable=self.api_key, show="*", width=40).grid(row=1, column=1, columnspan=3, sticky="ew", pady=2)

        self.apply_preset("Normální")
        self.write("Připraveno. Klikněte na Odeslat jednou nebo Spustit opakování; otevření okna ještě nic neodesílá.")

    # ---------- pomocné ----------
    def write(self, text, tag=None):
        stamp = datetime.now().strftime("%H:%M:%S")
        self.log.configure(state="normal")
        self.log.insert("end", f"[{stamp}] {text}\n", tag)
        self.log.see("end")
        self.log.configure(state="disabled")

    def apply_preset(self, name):
        for key, value in PRESETS[name].items():
            self.vars[key].set(value)
        self.paused.set(False)
        self.write(f"Nastaven stav: {name}")

    def preset_offline(self):
        self.paused.set(True)
        self.write("Výpadek stanice: odesílání je pozastaveno.")

    def build_payload(self):
        measurements = {}
        for key, _label, lo, hi, noise in FIELDS:
            raw = self.vars[key].get().strip().replace(",", ".")
            if raw == "":
                measurements[key] = None
                continue
            value = float(raw)  # ValueError se zachytí výše
            if self.jitter.get():
                value += random.uniform(-noise, noise)
            value = min(max(value, lo), hi)
            measurements[key] = round(value, 2)

        blower = {"Neznámé": None, "Běží": True, "Neběží": False}[self.blower.get()]
        self.counter += 1
        return {
            "device_id": DEVICE_ID,
            "sample_id": f"sim-{self.boot}-{self.counter:06d}",
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "measurements": measurements,
            "blower": blower,
        }

    # ---------- odesílání ----------
    def send_once(self):
        try:
            url = server_origin(self.server.get()) + "/api/v1/telemetry"
            key = self.api_key.get().strip()
            if not key:
                raise ValueError("Vyplňte API klíč stanice z příkazu npm run setup.")
            payload = self.build_payload()
        except ValueError as exc:
            self.write(f"Neplatná adresa nebo číslo: {exc}", "err")
            return
        self.write(f"Odesílám {payload['sample_id']} → {url}")
        threading.Thread(target=self.post, args=(url, payload, key), daemon=True).start()

    def check_server(self):
        try:
            origin = server_origin(self.server.get())
            key = self.api_key.get().strip()
            if not key:
                raise ValueError("Vyplňte API klíč stanice.")
        except ValueError as exc:
            self.write(str(exc), "err")
            return
        def check():
            try:
                with request.urlopen(request.Request(origin + "/api/v1/device/status", headers={"X-API-Key": key}), timeout=10) as response:
                    state = json.load(response)
                mode = state["mode"]
                seen = state.get("last_seen")
                message = f"Server {origin} odpovídá. Režim: {mode}. "
                message += "Dosud nepřijal žádný vzorek stanice." if seen is None else "Má uložená data ze stanice."
                self.root.after(0, self.write, message, "ok")
            except Exception as exc:
                self.root.after(0, self.write, f"Kontrola {origin} selhala: {exc}", "err")
        threading.Thread(target=check, daemon=True).start()

    def post(self, url, payload, key):
        data = json.dumps(payload).encode("utf-8")
        req = request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json", "X-API-Key": key})
        short = ", ".join(f"{k}={v}" for k, v in payload["measurements"].items())
        try:
            with request.urlopen(req, timeout=10) as resp:
                body = resp.read().decode("utf-8", "replace")
                msg, tag = f"{resp.status} OK  {short}", "ok"
                if resp.status == 200 and json.loads(body).get("duplicate") is True:
                    msg = f"200 duplicitní vzorek  {payload['sample_id']}"
        except error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:300]
            msg, tag = f"Chyba {e.code}: {body}", "err"
        except Exception as e:  # server nedostupný apod.
            msg, tag = f"Server nedostupný: {e}", "err"
        self.root.after(0, self.write, msg, tag)

    def toggle(self):
        self.running = not self.running
        self.start_btn.configure(text="Zastavit opakování" if self.running else "Spustit opakování")
        if self.running:
            self.write("Opakované odesílání spuštěno.")
            self.tick()
        else:
            if self.tick_id is not None:
                self.root.after_cancel(self.tick_id)
                self.tick_id = None
            self.write("Opakované odesílání zastaveno.")

    def tick(self):
        self.tick_id = None
        if not self.running:
            return
        if self.paused.get():
            self.write("Výpadek: vzorek se neodesílá.")
        else:
            self.send_once()
        try:
            delay = max(1.0, float(self.interval.get().replace(",", ".")))
        except ValueError:
            delay = 5.0
        self.tick_id = self.root.after(int(delay * 1000), self.tick)


if __name__ == "__main__":
    root = tk.Tk()
    App(root)
    root.mainloop()
