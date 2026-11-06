#pragma once
String candidateSsid, candidatePassword;
bool candidateConnected = false;

String displaySetupPassword() {
  const char alphabet[] = "abcdefghjkmnpqrstuvwxyz23456789";
  String value;
  for (int i = 0; i < 8; i++) value += alphabet[esp_random() % (sizeof(alphabet) - 1)];
  return value;
}
void loadDisplayConfig() {
  Preferences p; p.begin("cov-display", false);
  apPassword = p.getString("ap-pass", "");
  // Migrate the long hex password once, preserving all saved home credentials.
  if (apPassword.length() != 8 || p.getUChar("ap-pass-ver", 0) != 2) {
    apPassword = displaySetupPassword();
    p.putString("ap-pass", apPassword); p.putUChar("ap-pass-ver", 2);
  }
  JsonDocument doc;
  if (!deserializeJson(doc, p.getString("config", "{}"))) {
    ssid = doc["ssid"] | ""; password = doc["password"] | "";
    serverUrl = doc["server"] | ""; displayKey = doc["key"] | "";
  }
  p.end();
}
bool displayUrlValid(String url) {
  if (!url.startsWith("http://") || url.length() > 200) return false;
  String host = url.substring(7); int colon = host.indexOf(':');
  if (colon >= 0) {
    String port = host.substring(colon + 1);
    if (port.isEmpty() || port.length() > 5) return false;
    for (size_t i = 0; i < port.length(); i++) if (!isdigit((unsigned char)port[i])) return false;
    if (port.toInt() < 1 || port.toInt() > 65535) return false;
    host = host.substring(0, colon);
  }
  if (host.isEmpty() || host == "localhost" || host.startsWith("127.") || host == "0.0.0.0") return false;
  for (size_t i = 0; i < host.length(); i++) {
    char c = host[i]; if (!isalnum((unsigned char)c) && c != '.' && c != '-') return false;
  }
  return true;
}
bool beginDisplayMdns() {
  if (!mdnsReady && WiFi.status() == WL_CONNECTED)
    mdnsReady = MDNS.begin(("cov-display-" + String((uint32_t)ESP.getEfuseMac(), HEX)).c_str());
  return mdnsReady;
}
String resolveDisplayUrl(String url) {
  String authority = url.substring(7); int colon = authority.indexOf(':');
  String host = colon < 0 ? authority : authority.substring(0, colon);
  String port = colon < 0 ? "" : authority.substring(colon);
  if (host.endsWith(".local") && beginDisplayMdns()) {
    IPAddress ip = MDNS.queryHost(host.substring(0, host.length() - 6), 1500);
    if (ip != IPAddress(0, 0, 0, 0)) return "http://" + ip.toString() + port;
  }
  return url;
}
void displaySetupReply(int code, const String& message) {
  JsonDocument doc; doc[code < 400 ? "message" : "error"] = message;
  String encoded; serializeJson(doc, encoded);
  web.sendHeader("Cache-Control", "no-store"); web.send(code, "application/json; charset=utf-8", encoded);
}
bool displaySetupAuthorized() {
  if (web.client().localIP() != WiFi.softAPIP() || web.header("X-Setup-Token") != setupToken) {
    displaySetupReply(403, "Otevřete znovu nastavovací stránku."); return false;
  }
  if (web.arg("plain").length() > 2048) { displaySetupReply(413, "Příliš velká zpráva."); return false; }
  return true;
}
bool displayCandidateReady() {
  return candidateConnected && !candidateSsid.isEmpty() && WiFi.status() == WL_CONNECTED && WiFi.SSID() == candidateSsid;
}
#include "display_pairing.h"
bool saveDisplayCandidate(const String& url, const String& key) {
  JsonDocument doc;
  doc["ssid"] = candidateSsid; doc["password"] = candidatePassword;
  doc["server"] = url; doc["key"] = key;
  String encoded; serializeJson(doc, encoded);
  Preferences p; p.begin("cov-display", false);
  size_t saved = p.putString("config", encoded); p.end();
  if (saved != encoded.length()) { displaySetupReply(500, "Uložení selhalo."); return false; }
  displaySetupReply(200, "Uloženo. Displej se restartuje."); delay(500); ESP.restart();
  return true;
}
void serveDisplayPortal() {
  if (web.client().localIP() != WiFi.softAPIP()) { web.send(403, "text/plain", "Use setup Wi-Fi"); return; }
  String html = R"HTML(<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Displej ČOV</title>
<style>body{font:16px system-ui;max-width:36rem;margin:0 auto;padding:20px;background:#f3f5f5;color:#202e32}h1{margin:8px 0}h2{font-size:19px;margin-top:0}p{line-height:1.6}section{background:white;border:1px solid #dce5e4;border-radius:12px;padding:20px;margin:16px 0}label{display:block;margin-top:12px}input,select,button{box-sizing:border-box;width:100%;padding:12px;margin-top:6px;font:inherit;border:1px solid #c7d6d2;border-radius:7px}input,select{background:#f8faf9}button{background:#197c67;color:white;cursor:pointer}button.secondary{background:white;color:#197c67}button:disabled{opacity:.55;cursor:wait}small{display:block;line-height:1.6;color:#5a6e6b}#message{position:sticky;bottom:0;background:#eaf4ef;padding:14px;border-radius:8px}#message:empty{display:none}#message.error{background:#fff0ed;color:#a3261e}[hidden]{display:none!important}.inline{display:flex;align-items:center;gap:8px}.inline input{width:auto;margin:0}</style>
<h1>Nastavení displeje</h1><p>Připojte displej k domácí síti a vyberte server ČOV.</p>
<section><h2>1. Domácí Wi-Fi</h2><label>Dostupné sítě<select id="networks"><option value="">Vyhledávám sítě…</option></select></label><button type="button" class="secondary" id="scan">Znovu vyhledat Wi-Fi</button><label>Název Wi-Fi (SSID)<input id="ssid" maxlength="32" autocomplete="off" placeholder="Nebo zadejte skrytou síť ručně"></label><label>Heslo domácí Wi-Fi<input id="password" type="password" maxlength="64" autocomplete="new-password"></label><label class="inline"><input id="show-password" type="checkbox">Zobrazit heslo</label><button type="button" id="connect">Připojit k Wi-Fi</button><small>Použijte síť 2,4 GHz. Při připojování se mobil může krátce odpojit; vraťte se na Wi-Fi displeje.</small></section>
<section><h2>2. Server ČOV</h2><label>Nalezené servery<select id="servers"><option value="">Nejprve připojte domácí Wi-Fi</option></select></label><button type="button" class="secondary" id="discover" disabled>Znovu vyhledat server</button><label>Adresa serveru<input id="server" type="url" placeholder="http://raspberrypi.local:4173" autocapitalize="none" spellcheck="false"></label><small>Když se server nenajde, adresu zadejte ručně. Nepoužívejte localhost.</small></section>
<section><h2>3. Přístup k přehledu</h2><p>Ve webu ČOV otevřete <b>Nastavení → Připojení → Domácí displeje</b> a zvolte <b>Spárovat nový displej</b>. Pak sem vložte krátký kód.</p><label>Párovací kód<input id="code" placeholder="ABCD-EFGH" maxlength="16" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" style="text-transform:uppercase;letter-spacing:.12em"></label><small id="code-hint">Osm znaků, platnost 10 minut. Dlouhý přístup si displej uloží automaticky.</small><button type="button" id="save" disabled>Ověřit a uložit</button><button type="button" class="secondary" id="wifi" hidden disabled>Uložit pouze změnu Wi-Fi</button></section><p id="message" role="status" aria-live="polite"></p>
<script>
const token='__TOKEN__',el=id=>document.getElementById(id);let busy=false,connected=false;
async function call(path,data={}){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Token':token},body:JSON.stringify(data)});const v=await r.json();if(!r.ok)throw Error(v.error||'Operace selhala');return v}
function message(text,failed=false){el('message').textContent=text;el('message').className=failed?'error':''}
function controls(){for(const id of ['scan','connect','discover','save','wifi'])el(id).disabled=busy||(['discover','save','wifi'].includes(id)&&!connected);for(const id of ['ssid','password','networks'])el(id).disabled=busy}
async function run(action){if(busy)return;busy=true;controls();try{await action()}catch(e){message(e.message,true)}finally{busy=false;controls()}}
async function scan(){message('Vyhledávám Wi-Fi…');const v=await call('/scan');el('networks').replaceChildren(new Option('Zadejte síť ručně',''));for(const n of v.networks)el('networks').add(new Option(n.ssid+' ('+n.rssi+' dBm)',n.ssid));if([...el('networks').options].some(n=>n.value===el('ssid').value))el('networks').value=el('ssid').value;message(v.networks.length?'Vyberte Wi-Fi a zadejte její heslo.':'Žádná síť nenalezena. SSID lze zadat ručně.')}
async function discover(){message('Vyhledávám server ČOV…');const v=await call('/discover');el('servers').replaceChildren(new Option('Zadejte adresu ručně',''));for(const s of v.servers)el('servers').add(new Option(s,s));if(v.servers.includes(el('server').value))el('servers').value=el('server').value;else if(v.servers.length===1){el('servers').value=v.servers[0];el('server').value=v.servers[0]}message(v.servers.length?'Vyberte server a vložte párovací kód.':'Wi-Fi připojena, server se nenašel. Zadejte jeho adresu ručně.')}
function networkEdited(){connected=false;controls()}
el('networks').onchange=()=>{el('ssid').value=el('networks').value;networkEdited()};
el('ssid').oninput=networkEdited;el('password').oninput=networkEdited;
el('servers').onchange=()=>{if(el('servers').value)el('server').value=el('servers').value};
el('show-password').onchange=()=>el('password').type=el('show-password').checked?'text':'password';
el('scan').onclick=()=>run(scan);el('discover').onclick=()=>run(discover);
el('connect').onclick=()=>run(async()=>{connected=false;message('Připojuji k domácí Wi-Fi…');await call('/connect',{ssid:el('ssid').value,password:el('password').value});connected=true;await discover()});
el('save').onclick=()=>run(async()=>{message('Ověřuji přístup k přehledu…');await call('/save',{server:el('server').value,code:el('code').value.trim()});el('code').value='';el('password').value='';message('Uloženo. Displej se restartuje.')});
el('wifi').onclick=()=>run(async()=>{message('Ověřuji uložený server…');await call('/wifi');el('password').value='';message('Wi-Fi uložena. Displej se restartuje.')});
run(async()=>{const v=await call('/status');connected=!!v.connected;el('ssid').value=v.connected?v.candidateSsid:v.ssid;el('server').value=v.server;if(v.hasKey){el('code-hint').textContent='Displej už je spárovaný. Pro stejný server nechte kód prázdný; pro nové párování vložte nový kód.';el('wifi').hidden=false}await scan();if(connected)await discover()});
</script></html>)HTML";
  html.replace("__TOKEN__", setupToken);
  web.sendHeader("Cache-Control", "no-store"); web.sendHeader("X-Frame-Options", "DENY");
  web.send(200, "text/html; charset=utf-8", html);
}
void startDisplaySetup() {
  if (setupActive) return;
  setupActive = true; setupStarted = millis(); setupToken = randomToken(16);
  candidateConnected = false; candidateSsid = ""; candidatePassword = "";
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(("COV-Display-" + String((uint32_t)ESP.getEfuseMac(), HEX)).c_str(), apPassword.c_str());
  WiFi.AP.enableDhcpCaptivePortal(); dns.start(53, "*", WiFi.softAPIP());
  const char* headers[] = {"X-Setup-Token"}; web.collectHeaders(headers, 1);
  web.on("/", HTTP_GET, serveDisplayPortal); web.onNotFound(serveDisplayPortal);
  web.on("/status", HTTP_POST, []() {
    if (!displaySetupAuthorized()) return;
    JsonDocument doc; doc["ssid"] = ssid; doc["server"] = serverUrl; doc["hasKey"] = !displayKey.isEmpty();
    doc["connected"] = displayCandidateReady(); doc["candidateSsid"] = candidateSsid;
    String out; serializeJson(doc, out); web.send(200, "application/json", out);
  });
  web.on("/scan", HTTP_POST, []() {
    if (!displaySetupAuthorized()) return;
    int count = WiFi.scanNetworks(false, true);
    if (count < 0) { WiFi.scanDelete(); displaySetupReply(503, "Vyhledání Wi-Fi se nezdařilo. Zkuste je zopakovat."); return; }
    JsonDocument doc; JsonArray networks = doc["networks"].to<JsonArray>();
    for (int i = 0; i < count && networks.size() < 30; i++) {
      String name = WiFi.SSID(i); if (name.isEmpty()) continue;
      bool duplicate = false; for (JsonObject n : networks) if (n["ssid"].as<String>() == name) duplicate = true;
      if (duplicate) continue;
      JsonObject item = networks.add<JsonObject>(); item["ssid"] = name; item["rssi"] = WiFi.RSSI(i);
    }
    WiFi.scanDelete(); String out; serializeJson(doc, out); web.send(200, "application/json", out);
  });
  web.on("/connect", HTTP_POST, []() {
    if (!displaySetupAuthorized()) return;
    candidateConnected = false;
    JsonDocument doc;
    if (deserializeJson(doc, web.arg("plain"))) { displaySetupReply(400, "Neplatná data."); return; }
    candidateSsid = doc["ssid"] | ""; candidatePassword = doc["password"] | "";
    if (candidateSsid.isEmpty() || candidateSsid.length() > 32 || candidatePassword.length() > 64) { displaySetupReply(400, "Zkontrolujte SSID a heslo Wi-Fi."); return; }
    if (mdnsReady) { MDNS.end(); mdnsReady = false; }
    WiFi.disconnect(false, false);
    WiFi.begin(candidateSsid.c_str(), candidatePassword.c_str()); unsigned long started = millis();
    while ((WiFi.status() != WL_CONNECTED || WiFi.SSID() != candidateSsid) && millis() - started < 15000) delay(20);
    if (WiFi.status() != WL_CONNECTED || WiFi.SSID() != candidateSsid) { displaySetupReply(400, "Wi-Fi se nepřipojila. Ověřte heslo a síť 2,4 GHz."); return; }
    candidateConnected = true; beginDisplayMdns(); displaySetupReply(200, "Připojeno k Wi-Fi.");
  });
  web.on("/discover", HTTP_POST, []() {
    if (!displaySetupAuthorized()) return;
    if (!displayCandidateReady()) { displaySetupReply(400, "Nejprve připojte domácí Wi-Fi."); return; }
    if (!beginDisplayMdns()) { displaySetupReply(503, "Vyhledávání serveru není dostupné. Zadejte adresu ručně."); return; }
    JsonDocument doc; JsonArray servers = doc["servers"].to<JsonArray>();
    int count = MDNS.queryService("cov-monitor", "tcp");
    for (int i = 0; i < count && i < 20; i++) {
      String host = MDNS.hostname(i); if (!host.endsWith(".local")) host += ".local";
      String url = "http://" + host + ":" + String(MDNS.port(i));
      if (displayUrlValid(url)) servers.add(url);
    }
    String out; serializeJson(doc, out); web.send(200, "application/json", out);
  });
  auto save = [](bool wifiOnly) {
    if (!displaySetupAuthorized()) return;
    if (!displayCandidateReady()) { displaySetupReply(400, "Nejprve připojte domácí Wi-Fi."); return; }
    JsonDocument doc;
    if (!wifiOnly && deserializeJson(doc, web.arg("plain"))) { displaySetupReply(400, "Neplatná data."); return; }
    String url = wifiOnly ? serverUrl : doc["server"].as<String>();
    String key = displayKey;
    String code = wifiOnly ? "" : String(doc["code"] | "");
    while (url.endsWith("/")) url.remove(url.length() - 1);
    if (!displayUrlValid(url)) { displaySetupReply(400, "Zkontrolujte adresu serveru."); return; }
    if (code.isEmpty() && (url != serverUrl || key.isEmpty())) { displaySetupReply(400, "Vložte párovací kód z webu ČOV."); return; }
    if (!code.isEmpty() && !claimDisplayPairing(url, code, key)) return;
    bool keyValid = key.length() == 64;
    for (size_t i = 0; i < key.length(); i++) if (!isxdigit((unsigned char)key[i])) keyValid = false;
    if (!displayUrlValid(url) || !keyValid) { displaySetupReply(400, "Přístup displeje není platný. Vytvořte nový párovací kód."); return; }
    JsonDocument candidate;
    if (!readDisplayOverview(url, key, candidate)) { displaySetupReply(400, "Server nebo uložený přístup nefunguje. Ověřte adresu, případně vytvořte nový párovací kód."); return; }
    saveDisplayCandidate(url, key);
  };
  web.on("/save", HTTP_POST, [save]() { save(false); });
  web.on("/wifi", HTTP_POST, [save]() { save(true); });
  web.begin(); paintOverview();
}
