// Root-owned, Raspberry Pi-only NetworkManager adapter. No shell commands.
const fs = require("node:fs");
const http = require("node:http");
const { randomUUID, randomBytes } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);
const error = (message, status = 400) =>
  Object.assign(Error(message), { status });
const escapeKeyfile = (text) =>
  text.replaceAll("\\", "\\\\").replace(/^ /, "\\s").replace(/ $/, "\\s");
function validateNetwork(input) {
  if (
    !input ||
    typeof input.ssid !== "string" ||
    !input.ssid.trim() ||
    Buffer.byteLength(input.ssid) > 32 ||
    /[\x00-\x1f\x7f]/.test(input.ssid)
  )
    throw error("Zadejte SSID do 32 bajtů bez řídicích znaků.");
  if (
    typeof input.password !== "string" ||
    !(
      /^[\x20-\x7e]{8,63}$/.test(input.password) ||
      /^[a-fA-F0-9]{64}$/.test(input.password)
    )
  )
    throw error(
      "Heslo WPA/WPA2 musí mít 8–63 tisknutelných ASCII znaků nebo 64 hexadecimálních znaků.",
    );
  if (input.hidden !== undefined && typeof input.hidden !== "boolean")
    throw error("Neplatná volba skryté sítě.");
  return { ssid: input.ssid, password: input.password, hidden: !!input.hidden };
}
function splitNm(line) {
  const values = [];
  let current = "",
    escaped = false;
  for (const char of line) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") escaped = true;
    else if (char === ":") {
      values.push(current);
      current = "";
    } else current += char;
  }
  return [...values, current];
}
class NetworkController {
  constructor({
    config,
    nm,
    now = Date.now,
    saveProfile,
    removeProfile,
    saveJob = () => {},
    pending = null,
  }) {
    Object.assign(this, {
      config,
      nm,
      now,
      saveProfile,
      removeProfile,
      saveJob,
    });
    this.disconnectedAt = null;
    this.busy = false;
    this.checking = false;
    this.lastResult = null;
    this.pending = pending;
  }
  async status() {
    const rows = (
      await this.nm(["-t", "-f", "DEVICE,TYPE,STATE", "device", "status"])
    )
      .trim()
      .split("\n")
      .map(splitNm);
    const wifi = rows.some(
      ([dev, type, state]) =>
        dev === "wlan0" && type === "wifi" && state === "connected",
    );
    const ethernet = rows.some(
      ([, type, state]) => type === "ethernet" && state.startsWith("connected"),
    );
    const uuid = wifi
      ? (
          await this.nm(["-g", "GENERAL.CON-UUID", "device", "show", "wlan0"])
        ).trim()
      : "";
    const setup = wifi && uuid === this.config.apUuid;
    const ssid =
      wifi && !setup
        ? (
            await this.nm([
              "-e",
              "no",
              "-g",
              "802-11-wireless.ssid",
              "connection",
              "show",
              uuid,
            ])
          ).replace(/\r?\n$/, "")
        : null;
    return {
      available: true,
      wifi: wifi && !setup,
      ethernet,
      setup,
      ssid,
      busy: this.busy,
      result: this.lastResult,
      uuid,
    };
  }
  async scan() {
    if (this.busy) throw error("Probíhá změna připojení.", 409);
    const rows = (
      await this.nm([
        "-t",
        "-f",
        "SSID,SIGNAL,SECURITY",
        "device",
        "wifi",
        "list",
        "ifname",
        "wlan0",
        "--rescan",
        "yes",
      ])
    )
      .trim()
      .split("\n")
      .map(splitNm);
    return {
      networks: [
        ...new Map(
          rows
            .filter(([ssid]) => ssid)
            .map(([ssid, signal, security]) => [
              ssid,
              { ssid, signal: Number(signal), security },
            ]),
        ).values(),
      ],
    };
  }
  async hotspot() {
    await this.nm([
      "--wait",
      "12",
      "connection",
      "up",
      "uuid",
      this.config.apUuid,
    ]);
    this.disconnectedAt = null;
  }
  async tick() {
    if (this.busy || this.checking) return;
    this.checking = true;
    let ownsTransition = false;
    try {
      const state = await this.status();
      if (this.busy) return;
      if (this.pending) {
        this.busy = true;
        ownsTransition = true;
        const job = this.pending;
        if (state.wifi && state.uuid === job.candidate) {
          this.saveJob(null);
          this.lastResult = "connected";
        } else {
          await this.rollback(job);
          this.pending = null;
          return;
        }
        this.pending = null;
      }
      if (state.wifi || state.ethernet || state.setup)
        this.disconnectedAt = null;
      else {
        this.disconnectedAt ??= this.now();
        if (this.now() - this.disconnectedAt >= 300000) {
          this.busy = true;
          ownsTransition = true;
          await this.hotspot();
        }
      }
    } finally {
      this.checking = false;
      if (ownsTransition) this.busy = false;
    }
  }
  async rollback(job) {
    try {
      await this.nm(["connection", "delete", "uuid", job.candidate]);
    } catch {}
    this.removeProfile(job.candidate);
    let restored = false;
    if (job.previous) {
      try {
        await this.nm([
          "--wait",
          "12",
          "connection",
          "up",
          "uuid",
          job.previous,
        ]);
        restored = true;
      } catch {}
    }
    if (!restored) await this.hotspot();
    this.saveJob(null);
    this.lastResult = "failed";
  }
  async connect(input) {
    input = validateNetwork(input);
    if (this.busy || this.pending) throw error("Probíhá změna připojení.", 409);
    this.busy = true;
    let job;
    try {
      const state = await this.status();
      const candidate = randomUUID();
      job = { candidate, previous: state.wifi ? state.uuid : null };
      const filename = this.saveProfile(
        candidate,
        `[connection]\nid=COV home ${candidate}\nuuid=${candidate}\ntype=wifi\ninterface-name=wlan0\nautoconnect=true\nautoconnect-priority=50\n\n[wifi]\nmode=infrastructure\nssid=${escapeKeyfile(input.ssid)}\nhidden=${input.hidden}\n\n[wifi-security]\nkey-mgmt=wpa-psk\npsk=${escapeKeyfile(input.password)}\n\n[ipv4]\nmethod=auto\n\n[ipv6]\nmethod=auto\n`,
      );
      this.saveJob(job);
      await this.nm(["connection", "load", filename]);
      // This process continues after the browser is disconnected. nmcli bounds
      // association/DHCP to 40s, leaving time for rollback before 90s.
      await this.nm(["--wait", "40", "connection", "up", "uuid", candidate]);
      const after = await this.status();
      if (!after.wifi || after.uuid !== candidate)
        throw error("Připojení selhalo.");
      this.saveJob(null);
      this.lastResult = "connected";
      this.disconnectedAt = null;
    } catch {
      if (job) {
        try {
          await this.rollback(job);
        } catch (failure) {
          this.pending = job;
          throw failure;
        }
      } else this.lastResult = "failed";
    } finally {
      this.busy = false;
    }
  }
}
const portalPage = (token) =>
  `<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wi-Fi ČOV</title><style>body{font:18px system-ui;max-width:32rem;margin:2rem auto;padding:1rem;background:#f3f5f5;color:#202e32}input,select,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0}button{background:#197c67;color:white;border:0}label{display:block}</style><h1>Připojení maliny</h1><p>Vyberte domácí Wi-Fi nebo zadejte skrytou síť. Po uložení se mobil odpojí. Přepněte jej zpět na domácí síť. Při neúspěchu se nastavovací síť obnoví do 90 sekund.</p><button id="scan">Vyhledat sítě</button><select id="networks"><option value="">Zadejte síť ručně</option></select><form><label>Název sítě<input name="ssid" maxlength="32" required></label><label>Heslo Wi-Fi<input name="password" type="password" minlength="8" maxlength="64" required autocomplete="new-password"></label><label><input type="checkbox" name="hidden" style="width:auto"> Skrytá síť</label><button>Připojit</button></form><p id="message" role="status"></p><script>const token='${token}';const f=document.querySelector('form'),m=document.querySelector('#message'),list=document.querySelector('#networks');async function call(url,data){const r=await fetch(url,{method:data?'POST':'GET',headers:{'X-Setup-Token':token,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const v=await r.json();if(!r.ok)throw Error(v.error);return v}document.querySelector('#scan').onclick=async()=>{try{m.textContent='Vyhledávám…';const v=await call('/scan');list.replaceChildren(new Option('Zadejte síť ručně',''));for(const n of v.networks)list.add(new Option(n.ssid,n.ssid));m.textContent='Vyberte síť.'}catch(e){m.textContent=e.message}};list.onchange=()=>f.elements.ssid.value=list.value;f.onsubmit=async e=>{e.preventDefault();try{await call('/connect',{ssid:f.elements.ssid.value,password:f.elements.password.value,hidden:f.elements.hidden.checked});f.elements.password.value='';m.textContent='Připojuji. Přepněte mobil na domácí Wi-Fi; při neúspěchu se vraťte do této sítě.'}catch(e){m.textContent=e.message}};</script></html>`;
async function readBody(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 2048)
      throw error("Příliš velká zpráva.", 413);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw error("Neplatná data.");
  }
}
async function start() {
  const config = JSON.parse(
    fs.readFileSync("/etc/cov-monitor/network.json", "utf8"),
  );
  const nm = async (args) => {
    const wait = args.indexOf("--wait");
    const timeout = args.includes("--rescan")
      ? 15000
      : wait < 0
        ? 3000
        : (Number(args[wait + 1]) + 1) * 1000;
    return (
      await execute("/usr/bin/nmcli", args, {
        env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LC_ALL: "C" },
        timeout,
        maxBuffer: 131072,
      })
    ).stdout;
  };
  const jobFile = "/var/lib/cov-network/pending.json";
  const profile = (id) =>
    `/etc/NetworkManager/system-connections/cov-home-${id}.nmconnection`;
  const controller = new NetworkController({
    config,
    nm,
    saveProfile(id, data) {
      fs.writeFileSync(profile(id), data, { mode: 0o600 });
      return profile(id);
    },
    removeProfile(id) {
      fs.rmSync(profile(id), { force: true });
    },
    saveJob(job) {
      if (job) {
        fs.writeFileSync(jobFile + ".tmp", JSON.stringify(job), {
          mode: 0o600,
        });
        fs.renameSync(jobFile + ".tmp", jobFile);
      } else fs.rmSync(jobFile, { force: true });
    },
    pending: fs.existsSync(jobFile)
      ? JSON.parse(fs.readFileSync(jobFile, "utf8"))
      : null,
  });
  const token = randomBytes(32).toString("hex");
  const handler = (portal) => async (req, res) => {
    const json = (code, value) => {
      res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (portal) {
        if (
          req.headers.host !== "192.168.4.1:8080" ||
          (req.headers.origin &&
            req.headers.origin !== "http://192.168.4.1:8080")
        )
          throw error("Nepovolený původ.", 403);
        if (req.url === "/" && req.method === "GET") {
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Frame-Options": "DENY",
            "Content-Security-Policy":
              "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'",
          });
          return res.end(portalPage(token));
        }
        if (req.headers["x-setup-token"] !== token)
          throw error("Otevřete znovu nastavovací stránku.", 403);
      }
      if (req.url === "/status" && req.method === "GET") {
        const { uuid, ...publicState } = await controller.status();
        return json(200, publicState);
      }
      if (req.url === "/scan" && req.method === "GET")
        return json(200, await controller.scan());
      if (req.url === "/connect" && req.method === "POST") {
        const input = validateNetwork(await readBody(req));
        if (controller.busy || controller.pending)
          throw error("Probíhá změna připojení.", 409);
        // Reserve synchronously in connect before another request can enter.
        const work = controller.connect(input);
        json(202, {
          accepted: true,
          message: "Připojení se změní; mobil se může odpojit.",
        });
        void work.catch(() =>
          console.error("Obnova Wi-Fi selhala; zkontrolujte NetworkManager."),
        );
        return;
      }
      throw error("Nenalezeno.", 404);
    } catch (e) {
      json(
        e.status || 503,
        e.status
          ? e.message && { error: e.message }
          : { error: "Síťová operace selhala." },
      );
    }
  };
  const socket = "/run/cov-network/control.sock";
  fs.rmSync(socket, { force: true });
  const local = http.createServer(handler(false));
  local.requestTimeout = 10000;
  local.listen(socket, () => fs.chmodSync(socket, 0o660));
  let portal;
  const tick = async () => {
    try {
      await controller.tick();
      const state = await controller.status();
      if (state.setup && !portal) {
        portal = http.createServer(handler(true));
        portal.requestTimeout = 10000;
        portal.on("error", () => {
          portal?.close();
          portal = null;
        });
        portal.listen(8080, "192.168.4.1");
      } else if (!state.setup && portal) {
        portal.close();
        portal = null;
      }
    } catch {
      console.error("Kontrola síťového připojení selhala.");
    }
  };
  await tick();
  // Serial polling: never overlap nmcli state transitions.
  const poll = async () => {
    await tick();
    setTimeout(poll, 5000);
  };
  setTimeout(poll, 5000);
}
if (require.main === module)
  start().catch(() => {
    console.error("Síťová služba nemůže nastartovat.");
    process.exitCode = 1;
  });
module.exports = { NetworkController, validateNetwork, splitNm, escapeKeyfile };
