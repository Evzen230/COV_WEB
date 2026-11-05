#pragma once
#include <WebServer.h>
#include <DNSServer.h>
#include <ESPmDNS.h>
#include <mbedtls/gcm.h>
#include <mbedtls/md.h>

// Wire a service button between GPIO27 and GND. Hold for 5 seconds.
#ifndef COV_SETUP_PIN
#define COV_SETUP_PIN 27
#endif
WebServer setupWeb(80);
DNSServer setupDns;
bool setupActive = false, mdnsReady = false;
unsigned long setupStarted = 0, buttonSince = 0;
String setupToken, setupPassword;
String hexBytes(const uint8_t* bytes, size_t size) {
  String out; out.reserve(size * 2);
  const char* hex = "0123456789abcdef";
  for (size_t i=0;i<size;i++) { out += hex[bytes[i] >> 4]; out += hex[bytes[i] & 15]; }
  return out;
}
String randomHex(size_t size) { uint8_t bytes[32]; esp_fill_random(bytes, min(size, (size_t)32)); return hexBytes(bytes, min(size, (size_t)32)); }
String readableSetupPassword() {
  const char* alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  uint8_t bytes[10]; esp_fill_random(bytes, sizeof(bytes));
  String value; value.reserve(10);
  for (uint8_t byte : bytes) value += alphabet[byte & 31];
  return value;
}
bool normalizePairingCode(String& code) {
  code.replace("-", ""); code.replace(" ", ""); code.trim();
  if (code.length() == 32) {
    code.toLowerCase();
    for (size_t i=0;i<code.length();i++) if (!isxdigit((unsigned char)code[i])) return false;
    return true; // Codes from an older server remain usable.
  }
  code.toUpperCase();
  if (code.length() != 8) return false;
  const char* alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (size_t i=0;i<code.length();i++) if (!strchr(alphabet,code[i])) return false;
  return true;
}
bool unhex(String value, uint8_t* out, size_t count) {
  if (value.length() != count*2) return false;
  for (size_t i=0;i<count;i++) {
    char a=tolower(value[i*2]),b=tolower(value[i*2+1]);
    if (!isxdigit(a)||!isxdigit(b)) return false;
    out[i]=((a<='9'?a-'0':a-'a'+10)<<4)|(b<='9'?b-'0':b-'a'+10);
  }
  return true;
}
void shaBytes(String input, uint8_t* out) {
  mbedtls_sha256_context context; mbedtls_sha256_init(&context);
  mbedtls_sha256_starts(&context, 0); mbedtls_sha256_update(&context, (const uint8_t*)input.c_str(), input.length());
  mbedtls_sha256_finish(&context,out); mbedtls_sha256_free(&context);
}
bool openEnvelope(String secret, String envelope, JsonDocument& result) {
  JsonDocument doc; if (envelope.length()>4096 || deserializeJson(doc,envelope)) return false;
  String data=doc["data"]|""; if (data.length()>2048 || data.length()%2) return false;
  uint8_t key[32],iv[12],tag[16],encrypted[1024],plain[1025];
  shaBytes(secret,key);
  if (!unhex(doc["iv"]|"",iv,12)||!unhex(doc["tag"]|"",tag,16)||!unhex(data,encrypted,data.length()/2)) return false;
  mbedtls_gcm_context ctx; mbedtls_gcm_init(&ctx);
  int status=mbedtls_gcm_setkey(&ctx,MBEDTLS_CIPHER_ID_AES,key,256);
  if (!status) status=mbedtls_gcm_auth_decrypt(&ctx,data.length()/2,iv,12,nullptr,0,tag,16,encrypted,plain);
  mbedtls_gcm_free(&ctx); if (status) return false;
  plain[data.length()/2]=0; return !deserializeJson(result,(char*)plain);
}
// Resolve .local explicitly; never save a discovered IP in place of its hostname.
String resolveCovUrl(String url) {
  if (!url.startsWith("http://")) return "";
  int end=url.indexOf('/',7); if (end<0) end=url.length();
  String authority=url.substring(7,end); int colon=authority.indexOf(':');
  String host=colon<0?authority:authority.substring(0,colon);
  if (host.endsWith(".local")) {
    IPAddress ip=MDNS.queryHost(host.substring(0,host.length()-6));
    if (ip==IPAddress()) return "";
    return "http://"+ip.toString()+(colon<0?"":authority.substring(colon))+url.substring(end);
  }
  return url;
}
bool saveCovConfig(String ssid,String password,String url,String key,String id) {
  JsonDocument config; config["ssid"]=ssid; config["password"]=password; config["server"]=url;
  config["key"]=key; config["device_id"]=id;
  String encoded; serializeJson(config,encoded);
  Preferences prefs; if (!prefs.begin("cov",false)) return false;
  bool ok=prefs.putString("config",encoded)>0; prefs.end(); return ok;
}
const char SETUP_HTML[] PROGMEM = R"HTML(<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nastavení ČOV</title>
<style>body{font:17px system-ui;max-width:520px;margin:30px auto;padding:18px;background:#f3f6fa;color:#172635}input,select,button{box-sizing:border-box;width:100%;font:inherit;padding:12px;margin:8px 0 18px}button{background:#175d83;color:white;border:0;border-radius:8px}label{display:block}p{line-height:1.5}</style>
<h1>Připojení stanice ČOV</h1><p>Nejdřív připojte stanici k domácí Wi-Fi. Mobil ponechte na síti COV-Setup i při upozornění „bez internetu“.</p>
<label>Dostupné Wi-Fi<select id="networks"><option value="">Zadejte síť ručně</option></select></label><button id="scan">Vyhledat Wi-Fi</button>
<label>Název domácí Wi-Fi<input id="ssid" maxlength="32"></label><label>Heslo Wi-Fi<input id="password" type="password" maxlength="63"></label><button id="connect">Připojit k Wi-Fi</button>
<label>Dostupné servery<select id="servers"><option value="">Vyberte nebo zadejte adresu ručně</option></select></label><button id="discover">Vyhledat servery</button>
<label>Adresa serveru<input id="url" type="url" placeholder="http://192.168.1.100:4173" autocapitalize="none" spellcheck="false"></label><p>Pro testování může server běžet i na počítači. Zadejte jeho adresu v domácí síti, nikoli localhost.</p><label>Párovací kód z webu ČOV<input id="code" placeholder="ABCD-EFGH" autocomplete="one-time-code" maxlength="40" autocapitalize="characters" spellcheck="false" style="text-transform:uppercase;letter-spacing:.12em"></label><button id="pair">Spárovat a uložit</button><button id="wifi">Uložit pouze změnu Wi-Fi</button><p id="status" role="status"></p>
<script>
let token='__TOKEN__';const el=id=>document.getElementById(id);async function call(path,data){let r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Token':token},body:JSON.stringify(data||{})});let v=await r.json();if(!r.ok)throw Error(v.error||'Operace selhala');return v}
async function run(fn){try{el('status').textContent='Pracuji…';await fn()}catch(e){el('status').textContent=e.message}}
el('scan').onclick=()=>run(async()=>{let v=await call('/scan');el('networks').replaceChildren(new Option('Vyberte síť',''));for(let n of v.networks)el('networks').add(new Option(n,n));el('status').textContent='Vyberte domácí síť.'});
el('networks').onchange=()=>el('ssid').value=el('networks').value;
el('connect').onclick=()=>run(async()=>{await call('/connect',{ssid:el('ssid').value,password:el('password').value});el('status').textContent='Připojeno. Nyní vyhledejte server.'});
el('discover').onclick=()=>run(async()=>{let v=await call('/discover');el('servers').replaceChildren(new Option('Vyberte server',''));for(let s of v.servers)el('servers').add(new Option(s,s));el('status').textContent=v.servers.length?'Vyberte server.':'Server nenalezen. Zadejte adresu ručně.'});
el('servers').onchange=()=>el('url').value=el('servers').value;
el('pair').onclick=()=>run(async()=>{await call('/pair',{url:el('url').value,code:el('code').value.trim()});el('status').textContent='Uloženo. Stanice se restartuje a začne odesílat data.'});
el('wifi').onclick=()=>run(async()=>{await call('/wifi');el('status').textContent='Wi-Fi uložena, stanice se restartuje. Spárování zůstává zachované.'});
</script></html>)HTML";
String candidateSsid,candidatePassword;
bool setupAuthorized() {
  if (setupWeb.client().localIP()!=WiFi.softAPIP() || setupWeb.header("X-Setup-Token")!=setupToken) { setupWeb.send(403,"application/json","{\"error\":\"Otevřete znovu nastavovací stránku.\"}"); return false; }
  return true;
}
void setupReply(int status,String text) { JsonDocument doc;doc[status==200?"message":"error"]=text;String out;serializeJson(doc,out);setupWeb.send(status,"application/json",out); }
void serveCovPortal() {
  if(setupWeb.client().localIP()!=WiFi.softAPIP()){setupWeb.send(403,"text/plain","Use setup Wi-Fi");return;}
  String page=FPSTR(SETUP_HTML);page.replace("__TOKEN__",setupToken);
  setupWeb.sendHeader("Cache-Control","no-store");setupWeb.sendHeader("X-Frame-Options","DENY");
  setupWeb.send(200,"text/html; charset=utf-8",page);
}
void startCovSetup() {
  if (setupActive) return;
  Preferences prefs; prefs.begin("cov",false); setupPassword=prefs.getString("setup_pass","");
  if (setupPassword.length()!=10 || prefs.getUInt("setup_format",0)!=2) {
    setupPassword=readableSetupPassword(); prefs.putString("setup_pass",setupPassword); prefs.putUInt("setup_format",2);
  }
  prefs.end();
  setupToken=randomHex(24); setupActive=true; setupStarted=millis();
  WiFi.mode(WIFI_AP_STA); WiFi.softAP(("COV-Setup-"+String((uint32_t)ESP.getEfuseMac(),HEX)).c_str(),setupPassword.c_str());
  WiFi.AP.enableDhcpCaptivePortal();
  Serial.println("Setup Wi-Fi SSID (print on device label): "+WiFi.softAPSSID());
  Serial.println("Setup Wi-Fi password (print on device label): "+setupPassword);
  Serial.println("Setup URL: http://192.168.4.1");
  setupDns.start(53,"*",WiFi.softAPIP());
  const char* headers[]={"X-Setup-Token"}; setupWeb.collectHeaders(headers,1);
  setupWeb.on("/",HTTP_GET,serveCovPortal);
  // HTTP connectivity probes must receive the portal, never an Internet-success response.
  const char* probes[]={"/generate_204","/gen_204","/hotspot-detect.html","/library/test/success.html","/connecttest.txt","/ncsi.txt","/canonical.html","/redirect"};
  for (const char* path : probes) setupWeb.on(path,HTTP_GET,serveCovPortal);
  setupWeb.on("/scan",HTTP_POST,[](){if(!setupAuthorized())return;JsonDocument doc;JsonArray networks=doc["networks"].to<JsonArray>();int n=WiFi.scanNetworks();for(int i=0;i<n&&i<30;i++)networks.add(WiFi.SSID(i));WiFi.scanDelete();String out;serializeJson(doc,out);setupWeb.send(200,"application/json",out);});
  setupWeb.on("/connect",HTTP_POST,[](){
    if(!setupAuthorized())return;JsonDocument doc;if(deserializeJson(doc,setupWeb.arg("plain"))){setupReply(400,"Chybné zadání");return;}
    candidateSsid=doc["ssid"]|"";candidatePassword=doc["password"]|"";
    if(candidateSsid.isEmpty()||candidateSsid.length()>32||candidatePassword.length()>63){setupReply(400,"Zkontrolujte Wi-Fi údaje");return;}
    WiFi.begin(candidateSsid.c_str(),candidatePassword.c_str());unsigned long start=millis();while(WiFi.status()!=WL_CONNECTED&&millis()-start<15000)delay(50);
    if(WiFi.status()!=WL_CONNECTED){setupReply(400,"Připojení selhalo. Zkontrolujte heslo a použijte síť 2,4 GHz.");return;}
    if(!mdnsReady)mdnsReady=MDNS.begin(("cov-esp-"+String((uint32_t)ESP.getEfuseMac(),HEX)).c_str());setupReply(200,"Připojeno");
  });
  setupWeb.on("/discover",HTTP_POST,[](){if(!setupAuthorized())return;if(WiFi.status()!=WL_CONNECTED){setupReply(400,"Nejprve připojte Wi-Fi");return;}JsonDocument doc;JsonArray servers=doc["servers"].to<JsonArray>();int n=MDNS.queryService("cov-monitor","tcp");for(int i=0;i<n&&i<20;i++){String host=MDNS.hostname(i);if(!host.endsWith(".local"))host+=".local";servers.add("http://"+host+":"+String(MDNS.port(i)));}String out;serializeJson(doc,out);setupWeb.send(200,"application/json",out);});
  setupWeb.on("/pair",HTTP_POST,[](){
    if(!setupAuthorized())return;if(WiFi.status()!=WL_CONNECTED||candidateSsid.isEmpty()){setupReply(400,"Nejprve připojte domácí Wi-Fi");return;}
    JsonDocument input;if(deserializeJson(input,setupWeb.arg("plain"))){setupReply(400,"Chybné zadání");return;}
    String url=input["url"]|"",code=input["code"]|"";
    url.trim();
    while(url.endsWith("/"))url.remove(url.length()-1);
    if(!normalizePairingCode(code)||!url.startsWith("http://")||url.indexOf('/',7)>=0||url.indexOf('@')>=0||url.length()>200){setupReply(400,"Zadejte HTTP adresu serveru bez cesty a osmiznakový párovací kód");return;}
    uint8_t derived[32],identifier[32],proof[32];shaBytes(code,derived);String derivedHex=hexBytes(derived,32);shaBytes(derivedHex,identifier);
    String nonce=randomHex(16);mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),derived,32,(const uint8_t*)nonce.c_str(),nonce.length(),proof);
    JsonDocument request;request["codeHash"]=hexBytes(identifier,32);request["nonce"]=nonce;request["proof"]=hexBytes(proof,32);String data;serializeJson(request,data);
    WiFiClient client;HTTPClient http;http.setConnectTimeout(3000);http.setTimeout(5000);
    String endpoint=resolveCovUrl(url+"/api/v1/pair");
    if(endpoint.isEmpty()){setupReply(400,"Název serveru nelze přeložit. Zadejte místní IP adresu počítače a port, například http://192.168.1.100:4173.");return;}
    if(!http.begin(client,endpoint)){setupReply(400,"Adresu serveru se nepodařilo otevřít. Zkontrolujte http://, IP adresu a port.");return;}
    http.addHeader("Content-Type","application/json");int status=http.POST(data);String response=http.getString();http.end();
    Serial.printf("Pairing HTTP status: %d\n",status); // Never print the code, proof or reply containing credentials.
    if(status<=0){setupReply(400,"ESP32 se nemůže spojit se serverem (síťová chyba "+String(status)+"). Spusťte server pro domácí síť, zkontrolujte IP, port a firewall. Nepoužívejte localhost ani 127.0.0.1.");return;}
    if(status!=200){
      String reason;
      if(status==401)reason="Kód je neplatný nebo vypršel. Vygenerujte nový kód na tomto serveru a zopakujte párování bez restartu serveru.";
      else if(status==409)reason="Kód již byl použit. Vygenerujte nový párovací kód.";
      else if(status==429)reason="Příliš mnoho pokusů. Počkejte minutu a zkuste to znovu.";
      else if(status==404)reason="Na této adrese není párovací API. Ověřte adresu, port a aktualizaci serveru ČOV.";
      else reason="Server odmítl párování. Ověřte aktualizaci serveru a jeho adresu.";
      setupReply(400,"HTTP "+String(status)+": "+reason);return;
    }
    JsonDocument result;
    if(!openEnvelope(code,response,result)){setupReply(400,"Server odpověděl, ale ESP32 nemůže ověřit párovací odpověď. Aktualizujte server i ESP32 a vytvořte nový kód.");return;}
    String key=result["apiKey"]|"",id=result["device_id"]|"";
    if(key.length()!=64||id.isEmpty()||!saveCovConfig(candidateSsid,candidatePassword,url+"/api/v1/telemetry",key,id)){setupReply(500,"Nastavení se nepodařilo uložit. Vytvořte nový kód a zkuste znovu.");return;}
    setupReply(200,"Spárováno");delay(500);ESP.restart();
  });
  setupWeb.on("/wifi",HTTP_POST,[](){if(!setupAuthorized())return;if(WiFi.status()!=WL_CONNECTED||candidateSsid.isEmpty()||API_KEY.isEmpty()){setupReply(400,"Nejprve připojte Wi-Fi. Nová stanice vyžaduje párování.");return;}if(!saveCovConfig(candidateSsid,candidatePassword,SERVER_URL,API_KEY,DEVICE_ID)){setupReply(500,"Uložení selhalo");return;}setupReply(200,"Uloženo");delay(500);ESP.restart();});
  setupWeb.onNotFound([](){setupWeb.sendHeader("Location","http://192.168.4.1/");setupWeb.send(302,"text/plain","");});setupWeb.begin();
}
void handleCovSetup() {
  if (digitalRead(COV_SETUP_PIN)==LOW) {if(!buttonSince)buttonSince=millis();if(millis()-buttonSince>5000)startCovSetup();}else buttonSince=0;
  if(setupActive){setupDns.processNextRequest();setupWeb.handleClient();if(millis()-setupStarted>900000){setupWeb.stop();setupDns.stop();WiFi.softAPdisconnect(true);WiFi.mode(WIFI_STA);setupActive=false;}}
  if(!mdnsReady&&WiFi.status()==WL_CONNECTED)mdnsReady=MDNS.begin(("cov-esp-"+String((uint32_t)ESP.getEfuseMac(),HEX)).c_str());
}
unsigned long lastKeyRotation=0;
void rotateCovKey() {
  if(setupActive||WiFi.status()!=WL_CONNECTED||API_KEY.length()!=64||millis()-lastKeyRotation<86400000UL)return;
  lastKeyRotation=millis();int path=SERVER_URL.indexOf("/api/v1/telemetry");if(path<0)return;
  WiFiClient client;HTTPClient http;http.setConnectTimeout(3000);http.setTimeout(5000);
  if(!http.begin(client,resolveCovUrl(SERVER_URL.substring(0,path)+"/api/v1/device/credentials?device_id="+DEVICE_ID)))return;
  http.addHeader("X-API-Key",API_KEY);int status=http.POST("");String response=http.getString();http.end();JsonDocument result;
  if(status!=200||!openEnvelope(API_KEY,response,result))return;
  String next=result["apiKey"]|"";String id=result["device_id"]|"";
  if(next.length()==64&&id==DEVICE_ID&&saveCovConfig(WIFI_SSID,WIFI_PASSWORD,SERVER_URL,next,DEVICE_ID))API_KEY=next;
}
